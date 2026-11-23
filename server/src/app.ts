/**
 * Servidor HTTP do ShotFolder (Fastify).
 *
 * Ordem no envio de foto, da checagem mais barata para a mais cara:
 *   1. cabeçalhos, horário, aparelho e assinatura (antes de ler o corpo)
 *   2. pasta da lista, repetição, limites de uso e espaço livre
 *   3. recebe o corpo numa pasta temporária contando bytes e calculando o SHA-256
 *   4. confere tamanho, SHA-256 e o tipo real pelos primeiros bytes
 *   5. copia para a pasta de destino com nome gerado aqui, sem sobrescrever
 */
import { createHash, randomUUID } from "node:crypto";
import { constants, createWriteStream } from "node:fs";
import { copyFile, readdir, statfs, unlink } from "node:fs/promises";
import { join } from "node:path";
import { Transform, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { ALLOWED_CONTENT_TYPES, ROUTES, type ErrorCode, type UploadFields } from "@shotfolder/protocol";
import { authenticateFolders, authenticateUpload } from "@shotfolder/protocol/node";
import { checkFolderPath, defaultForbiddenRoots, destinationPath, generateFileName, sniffImageType } from "./files.js";
import { noopNotifier, type Notifier } from "./notify.js";
import { Pairing } from "./pairing.js";
import {
  audit,
  ensureStateDir,
  FILES,
  keyLookup,
  loadConfig,
  loadDevices,
  newDeviceId,
  saveDevices,
  SeenStore,
  type AuditEvent,
} from "./state.js";

export interface AppDeps {
  stateDir: string;
  now?: () => number;
  notify?: Notifier;
  /** Pastas proibidas; os testes trocam para poder usar pastas temporárias. */
  forbiddenRoots?: string[];
  /** Pareamento compartilhado com a API admin. Se ausente, cria um. */
  pairing?: Pairing;
  /** Registro de envios compartilhado com o painel (um dono só do arquivo). */
  seen?: SeenStore;
}

/** Cria o pareamento que grava o aparelho aceito em devices.json. */
export function createPairing(stateDir: string, now: () => number = Date.now, confirmMs?: number): Pairing {
  return new Pairing({
    now,
    newDeviceId,
    ...(confirmMs === undefined ? {} : { confirmMs }),
    onAccept: async (c) => {
      const devices = await loadDevices(stateDir);
      devices.push({ id: c.deviceId, name: c.name, publicKey: c.publicKey, createdAt: new Date(now()).toISOString() });
      await saveDevices(stateDir, devices);
      await audit(stateDir, now(), { event: "pair_accepted", deviceId: c.deviceId, name: c.name });
    },
  });
}

/** Erro com resposta HTTP já definida. */
class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

const AUTH_ERRORS: ReadonlySet<ErrorCode> = new Set(["clock_skew", "unknown_device", "bad_signature"]);

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const dir = deps.stateDir;
  const now = deps.now ?? Date.now;
  const notify = deps.notify ?? noopNotifier;
  const forbidden = deps.forbiddenRoots ?? defaultForbiddenRoots(dir);
  const pairing = deps.pairing ?? createPairing(dir, now);
  await ensureStateDir(dir);
  await cleanTmp(dir);
  const seen = deps.seen ?? (await SeenStore.open(dir));

  /** Envios em andamento (mesmo uploadId chegando duas vezes ao mesmo tempo). */
  const inFlight = new Set<string>();
  /** Uso por aparelho: horários dos últimos envios e bytes por dia. Zera ao reiniciar. */
  const recent = new Map<string, number[]>();
  const bytesToday = new Map<string, number>();
  const authed = new WeakMap<FastifyRequest, UploadFields>();

  /** Grava no log antes de responder (assim o log nunca fica atrás da resposta). */
  const log = (ev: AuditEvent): Promise<void> => audit(dir, now(), ev).catch(() => {});

  const app = Fastify({
    logger: false,
    bodyLimit: 16 * 1024, // só para corpos JSON; a foto é tratada como fluxo abaixo
    requestTimeout: 120_000,
    connectionTimeout: 30_000,
    return503OnClosing: true,
    // Campo a mais no JSON é recusado, não silenciosamente descartado.
    ajv: { customOptions: { removeAdditional: false } },
  });

  // A foto não é carregada na memória: o "parser" só repassa o fluxo de bytes.
  app.addContentTypeParser([...ALLOWED_CONTENT_TYPES], (_req, payload, done) => done(null, payload));

  const reject = (reply: FastifyReply, status: number, error: string) => reply.code(status).send({ error });

  // ---------- POST /v1/pair ----------
  app.post(
    ROUTES.pair,
    {
      schema: {
        body: {
          type: "object",
          required: ["token", "publicKey", "deviceName"],
          additionalProperties: false,
          properties: {
            token: { type: "string", maxLength: 64 },
            publicKey: { type: "string", maxLength: 400 },
            deviceName: { type: "string", maxLength: 40 },
          },
        },
      },
    },
    async (req, reply) => {
      const b = req.body as { token: string; publicKey: string; deviceName: string };
      await log({ event: "pair_submitted", ip: req.ip, name: b.deviceName });
      const outcome = await pairing.submit(b.token, b.publicKey, b.deviceName);
      if (outcome.status !== 201) await log({ event: "pair_failed", ip: req.ip, reason: outcome.body.error });
      return reply.code(outcome.status).send(outcome.body);
    },
  );

  // ---------- GET /v1/folders ----------
  app.get(ROUTES.folders, async (req, reply) => {
    const devices = await loadDevices(dir);
    const r = authenticateFolders(req.headers, { nowMs: now(), getPublicKey: keyLookup(devices) });
    if (!r.ok) {
      await log({ event: "folders_rejected", ip: req.ip, reason: r.error, field: r.field });
      return AUTH_ERRORS.has(r.error) ? reject(reply, 401, "unauthorized") : reject(reply, 400, r.error);
    }
    const cfg = await loadConfig(dir);
    return {
      folders: cfg.folders.map(({ id, name }) => ({ id, name })),
      defaultFolder: cfg.defaultFolder ?? null,
    };
  });

  // ---------- POST /v1/upload ----------
  app.post(
    ROUTES.upload,
    {
      // Autentica no onRequest: o corpo ainda não foi lido.
      onRequest: async (req, reply) => {
        const devices = await loadDevices(dir);
        const r = authenticateUpload(req.headers, { nowMs: now(), getPublicKey: keyLookup(devices) });
        if (!r.ok) {
          await log({ event: "upload_rejected", ip: req.ip, reason: r.error, field: r.field });
          return AUTH_ERRORS.has(r.error) ? reject(reply, 401, "unauthorized") : reject(reply, 400, r.error);
        }
        authed.set(req, r.value);
      },
    },
    async (req, reply) => {
      const f = authed.get(req)!;
      const base = { ip: req.ip, deviceId: f.deviceId, uploadId: f.uploadId, folder: f.folderId };

      const previous = seen.get(f.uploadId);
      if (previous) {
        if (previous.deviceId !== f.deviceId) {
          await log({ event: "upload_rejected", ...base, reason: "upload_id_conflict" });
          return reject(reply, 409, "upload_id_conflict");
        }
        await log({ event: "upload_duplicate", ...base, file: previous.file });
        return reply.code(200).send({ status: "duplicate", file: previous.file, folder: previous.folderId });
      }
      if (inFlight.has(f.uploadId)) return reject(reply, 409, "in_progress");

      inFlight.add(f.uploadId);
      try {
        const saved = await receive(f, req.body as Readable);
        await log({ event: "upload_saved", ...base, file: saved.file, bytes: Number(f.contentLength) });
        notify("Foto recebida", `${saved.file} → ${saved.folderName}`, {
          folderPath: saved.folderPath,
          filePath: saved.filePath,
        });
        return reply.code(201).send({ status: "saved", file: saved.file, folder: f.folderId });
      } catch (e) {
        if (e instanceof HttpError) {
          await log({ event: "upload_rejected", ...base, reason: e.code });
          return reject(reply, e.status, e.code);
        }
        await log({ event: "upload_error", ...base, reason: (e as Error).message });
        return reject(reply, 500, "internal_error");
      } finally {
        inFlight.delete(f.uploadId);
      }
    },
  );

  async function receive(
    f: UploadFields,
    body: Readable,
  ): Promise<{ file: string; folderName: string; folderPath: string; filePath: string }> {
    const cfg = await loadConfig(dir);
    const folder = cfg.folders.find((x) => x.id === f.folderId);
    if (!folder) throw new HttpError(404, "unknown_folder");

    // Limites de uso por aparelho.
    const t = now();
    const recentes = (recent.get(f.deviceId) ?? []).filter((x) => t - x < 60_000);
    if (recentes.length >= cfg.limits.maxUploadsPerMinute) throw new HttpError(429, "rate_limited");
    const dayKey = `${f.deviceId}:${new Date(t).toISOString().slice(0, 10)}`;
    const size = Number(f.contentLength);
    if ((bytesToday.get(dayKey) ?? 0) + size > cfg.limits.maxBytesPerDay) throw new HttpError(429, "daily_quota");
    recentes.push(t);
    recent.set(f.deviceId, recentes);

    const problem = await checkFolderPath(folder.path, forbidden);
    if (problem) throw new HttpError(500, "folder_unavailable");
    const fs = await statfs(folder.path);
    if (fs.bavail * fs.bsize - size < cfg.limits.minFreeBytes) throw new HttpError(507, "insufficient_storage");

    // Recebe numa pasta temporária, contando bytes e calculando o SHA-256.
    const tmp = join(dir, FILES.tmp, `${randomUUID()}.part`);
    const hash = createHash("sha256");
    let received = 0;
    let head = Buffer.alloc(0);
    const meter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        received += chunk.length;
        if (received > size) return cb(new HttpError(400, "size_mismatch"));
        hash.update(chunk);
        if (head.length < 16) head = Buffer.concat([head, chunk]).subarray(0, 16);
        cb(null, chunk);
      },
    });
    try {
      try {
        await pipeline(body, meter, createWriteStream(tmp, { flags: "wx" }));
      } catch (e) {
        if (e instanceof HttpError) throw e;
        throw new HttpError(400, "body_incomplete");
      }
      if (received !== size) throw new HttpError(400, "size_mismatch");
      if (hash.digest("hex") !== f.sha256) throw new HttpError(400, "hash_mismatch");
      if (sniffImageType(head) !== f.contentType) throw new HttpError(415, "content_mismatch");

      // Confere a pasta de novo logo antes de gravar (pode ter mudado no meio).
      if (await checkFolderPath(folder.path, forbidden)) throw new HttpError(500, "folder_unavailable");
      // copyFile com COPYFILE_EXCL: falha se já existir, nunca sobrescreve.
      // A cópia nasce na pasta de destino e herda as permissões dela.
      for (let tentativa = 0; tentativa < 5; tentativa++) {
        const file = generateFileName(t, f.contentType);
        try {
          await copyFile(tmp, destinationPath(folder.path, file), constants.COPYFILE_EXCL);
          bytesToday.set(dayKey, (bytesToday.get(dayKey) ?? 0) + size);
          await seen.add(
            f.uploadId,
            { deviceId: f.deviceId, folderId: f.folderId, file, at: new Date(t).toISOString(), bytes: size },
            t,
          );
          return {
            file,
            folderName: folder.name,
            folderPath: folder.path,
            filePath: destinationPath(folder.path, file),
          };
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
        }
      }
      throw new Error("Não consegui gerar um nome livre.");
    } finally {
      await unlink(tmp).catch(() => {});
    }
  }

  // Ao desligar, solta o celular que estiver esperando confirmação.
  app.addHook("preClose", async () => {
    if (!deps.pairing) pairing.cancel();
  });

  // Qualquer outra rota: 404 sem detalhes.
  app.setNotFoundHandler((_req, reply) => reject(reply, 404, "not_found"));
  app.setErrorHandler(async (err: { message?: string; statusCode?: number }, req, reply) => {
    await log({ event: "http_error", ip: req.ip, reason: err.message });
    const status = err.statusCode && err.statusCode < 500 ? err.statusCode : 500;
    return reject(reply, status, status === 500 ? "internal_error" : "bad_request");
  });

  return app;
}

/** Apaga restos de envios interrompidos. */
async function cleanTmp(dir: string): Promise<void> {
  const tmpDir = join(dir, FILES.tmp);
  for (const name of await readdir(tmpDir)) {
    if (name.endsWith(".part")) await unlink(join(tmpDir, name)).catch(() => {});
  }
}
