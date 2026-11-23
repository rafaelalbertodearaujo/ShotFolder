/**
 * Painel web, em http://127.0.0.1:<adminPort>/painel/ — só neste PC.
 *
 * Entrada: `shotfolder painel` pede à API admin (token local) um código de uso único,
 * válido por 60 s, e abre o navegador em /painel/entrar?c=<código>. O código vira um
 * cookie de sessão (12 h, some ao reiniciar o servidor).
 *
 * Proteções (um site qualquer aberto no navegador não consegue usar o painel):
 *   - cookie HttpOnly + SameSite=Strict: outro site não manda o cookie;
 *   - ações (POST) exigem o cabeçalho X-SF-CSRF com o segredo da sessão, e Origin igual ao do painel;
 *   - Host precisa ser exatamente 127.0.0.1:<porta> (bloqueia DNS rebinding);
 *   - CSP sem scripts de fora nem inline; a página monta tudo com textContent (sem innerHTML);
 *   - excluir só vale para fotos que o próprio ShotFolder gravou, e vai para a Lixeira.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { PATTERNS } from "@shotfolder/protocol";
import { readDaemonPid } from "./daemon.js";
import { checkFolderPath, defaultForbiddenRoots, destinationPath } from "./files.js";
import { isTailscaleIPv4 } from "./net.js";
import { revealInExplorer, sendToRecycleBin, type Recycler, type Revealer } from "./recycle.js";
import { shortcutPath } from "./startup.js";
import { audit, FILES, loadConfig, loadDevices, saveDevices, type SeenStore } from "./state.js";
import { existsSync } from "node:fs";

export const COOKIE = "sf_painel";
const CODE_TTL_MS = 60_000;
const SESSION_TTL_MS = 12 * 60 * 60_000;
const GENERATED_NAME = /^\d{4}-\d{2}-\d{2}_\d{6}_[0-9a-f]{4}\.(jpg|png|webp)$/;
const MIME: Record<string, string> = { ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };

const sha = (s: string) => createHash("sha256").update(s, "utf8").digest();
const same = (a: string, b: string) => timingSafeEqual(sha(a), sha(b));

/** Códigos de entrada e sessões, só na memória. */
export class PanelSessions {
  private codes = new Map<string, number>();
  private sessions = new Map<string, { csrf: string; expires: number }>();
  constructor(private readonly now: () => number = Date.now) {}

  mintCode(): string {
    const code = randomBytes(32).toString("base64url");
    this.codes.set(code, this.now() + CODE_TTL_MS);
    return code;
  }

  /** Troca o código (uma vez só) por uma sessão. */
  redeem(code: string): { id: string; csrf: string } | null {
    for (const [c, exp] of this.codes) if (exp < this.now()) this.codes.delete(c);
    let achado: string | null = null;
    for (const c of this.codes.keys()) if (same(c, code)) achado = c;
    if (!achado) return null;
    this.codes.delete(achado);
    const id = randomBytes(32).toString("base64url");
    const csrf = randomBytes(32).toString("base64url");
    this.sessions.set(id, { csrf, expires: this.now() + SESSION_TTL_MS });
    return { id, csrf };
  }

  get(id: string | undefined): { csrf: string } | null {
    if (!id) return null;
    const s = this.sessions.get(id);
    if (!s) return null;
    if (s.expires < this.now()) {
      this.sessions.delete(id);
      return null;
    }
    return s;
  }
}

export interface PanelDeps {
  stateDir: string;
  adminPort: number;
  publicHost: string;
  publicPort: number;
  seen: SeenStore;
  sessions: PanelSessions;
  startedAt: string;
  now?: () => number;
  forbiddenRoots?: string[];
  recycle?: Recycler;
  reveal?: Revealer;
}

function readCookie(req: FastifyRequest, name: string): string | undefined {
  const raw = req.headers.cookie;
  if (typeof raw !== "string") return undefined;
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return undefined;
}

const STATIC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "painel");
const STATIC: Record<string, { file: string; type: string }> = {
  "/painel/": { file: "index.html", type: "text/html; charset=utf-8" },
  "/painel/painel.css": { file: "painel.css", type: "text/css; charset=utf-8" },
  "/painel/painel.js": { file: "painel.js", type: "text/javascript; charset=utf-8" },
};

const PAGINA_SEM_SESSAO = `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>ShotFolder</title>
<link rel="stylesheet" href="/painel/painel.css"><body><main>
<h1>Painel do ShotFolder</h1>
<p>Sessão expirada ou link já usado. No PC, rode <code>shotfolder painel</code>
(ou abra o atalho "ShotFolder Painel" no Menu Iniciar).</p></body></html>`;

export function registerPanel(app: FastifyInstance, deps: PanelDeps): void {
  const now = deps.now ?? Date.now;
  const origin = `http://127.0.0.1:${deps.adminPort}`;
  const forbidden = deps.forbiddenRoots ?? defaultForbiddenRoots(deps.stateDir);
  const recycle = deps.recycle ?? sendToRecycleBin;
  const reveal = deps.reveal ?? revealInExplorer;
  const sessionOf = new WeakMap<FastifyRequest, { csrf: string }>();

  app.register(async (p) => {
    p.addHook("onSend", async (_req, reply, payload) => {
      reply.header(
        "content-security-policy",
        "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; " +
          "base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      );
      reply.header("x-content-type-options", "nosniff");
      reply.header("referrer-policy", "no-referrer");
      reply.header("cache-control", "no-store");
      reply.header("x-frame-options", "DENY");
      return payload;
    });

    p.addHook("onRequest", async (req, reply) => {
      if (req.headers.host !== `127.0.0.1:${deps.adminPort}`) return reply.code(403).send({ error: "forbidden" });
      if (req.routeOptions.url === "/painel/entrar") return;
      const s = deps.sessions.get(readCookie(req, COOKIE));
      if (!s) {
        if (req.method === "GET" && !req.url.startsWith("/painel/api/")) {
          return reply.code(401).type("text/html; charset=utf-8").send(PAGINA_SEM_SESSAO);
        }
        return reply.code(401).send({ error: "sem_sessao" });
      }
      if (req.method !== "GET") {
        const csrf = req.headers["x-sf-csrf"];
        const o = req.headers.origin;
        const site = req.headers["sec-fetch-site"];
        if (
          typeof csrf !== "string" ||
          !same(csrf, s.csrf) ||
          (o !== undefined && o !== origin) ||
          (site !== undefined && site !== "same-origin")
        ) {
          await audit(deps.stateDir, now(), { event: "panel_rejected", url: req.url }).catch(() => {});
          return reply.code(403).send({ error: "forbidden" });
        }
      }
      sessionOf.set(req, s);
    });

    // ---------- entrada ----------
    p.get("/painel/entrar", async (req, reply) => {
      const code = (req.query as { c?: unknown }).c;
      const s = typeof code === "string" ? deps.sessions.redeem(code) : null;
      if (!s) return reply.code(403).type("text/html; charset=utf-8").send(PAGINA_SEM_SESSAO);
      await audit(deps.stateDir, now(), { event: "panel_login" });
      reply.header(
        "set-cookie",
        `${COOKIE}=${s.id}; HttpOnly; SameSite=Strict; Path=/painel; Max-Age=${SESSION_TTL_MS / 1000}`,
      );
      return reply.redirect("/painel/", 302);
    });

    // ---------- arquivos da página ----------
    for (const [url, f] of Object.entries(STATIC)) {
      p.get(url, async (_req, reply) => reply.type(f.type).send(await readFile(join(STATIC_DIR, f.file))));
    }

    // ---------- API ----------
    p.get("/painel/api/sessao", async (req) => ({ csrf: sessionOf.get(req)!.csrf }));

    p.get("/painel/api/status", async () => {
      const cfg = await loadConfig(deps.stateDir);
      const devices = await loadDevices(deps.stateDir);
      return {
        host: deps.publicHost,
        port: deps.publicPort,
        modo: isTailscaleIPv4(deps.publicHost) ? "tailscale" : "teste-local",
        startedAt: deps.startedAt,
        vigia: (await readDaemonPid(deps.stateDir)) !== null,
        iniciaComWindows: existsSync(shortcutPath()),
        pastas: cfg.folders.length,
        aparelhosAtivos: devices.filter((d) => !d.revokedAt).length,
      };
    });

    p.get("/painel/api/fotos", async () => {
      const cfg = await loadConfig(deps.stateDir);
      const devices = await loadDevices(deps.stateDir);
      const fotos = [];
      for (const e of deps.seen.list().slice(0, 300)) {
        const folder = cfg.folders.find((f) => f.id === e.folderId);
        let existe = false;
        if (folder && !e.deletedAt && GENERATED_NAME.test(e.file)) {
          existe = await lstat(destinationPath(folder.path, e.file)).then(
            (s) => s.isFile(),
            () => false,
          );
        }
        fotos.push({
          uploadId: e.uploadId,
          file: e.file,
          folderId: e.folderId,
          folderName: folder?.name ?? null,
          at: e.at,
          bytes: e.bytes ?? null,
          aparelho: devices.find((d) => d.id === e.deviceId)?.name ?? e.deviceId,
          excluida: Boolean(e.deletedAt),
          existe,
        });
      }
      return { fotos };
    });

    /** Acha o arquivo de uma foto, só se for um que o ShotFolder gravou numa pasta da lista. */
    async function photoPath(uploadId: string, reply: FastifyReply): Promise<string | null> {
      const e = PATTERNS.uuid.test(uploadId) ? deps.seen.get(uploadId) : undefined;
      if (!e || e.deletedAt || !GENERATED_NAME.test(e.file)) {
        reply.code(404).send({ error: "nao_encontrada" });
        return null;
      }
      const folder = (await loadConfig(deps.stateDir)).folders.find((f) => f.id === e.folderId);
      if (!folder) {
        reply.code(409).send({ error: "pasta_fora_da_lista" });
        return null;
      }
      if (await checkFolderPath(folder.path, forbidden)) {
        reply.code(409).send({ error: "pasta_indisponivel" });
        return null;
      }
      const path = destinationPath(folder.path, e.file);
      const info = await lstat(path).catch(() => null);
      if (!info || !info.isFile() || info.isSymbolicLink()) {
        reply.code(404).send({ error: "arquivo_sumiu" });
        return null;
      }
      return path;
    }

    p.get("/painel/api/fotos/:id/arquivo", async (req, reply) => {
      const path = await photoPath((req.params as { id: string }).id, reply);
      if (!path) return reply;
      return reply.type(MIME[extname(path)] ?? "application/octet-stream").send(createReadStream(path));
    });

    p.post("/painel/api/fotos/:id/excluir", async (req, reply) => {
      const id = (req.params as { id: string }).id;
      const path = await photoPath(id, reply);
      if (!path) return reply;
      try {
        await recycle(path);
      } catch {
        return reply.code(500).send({ error: "lixeira_falhou" });
      }
      await deps.seen.markDeleted(id, now());
      await audit(deps.stateDir, now(), { event: "photo_recycled", uploadId: id, path });
      return { ok: true };
    });

    p.post("/painel/api/fotos/:id/mostrar", async (req, reply) => {
      const path = await photoPath((req.params as { id: string }).id, reply);
      if (!path) return reply;
      reveal(path);
      return { ok: true };
    });

    p.get("/painel/api/aparelhos", async () => ({
      aparelhos: (await loadDevices(deps.stateDir)).map((d) => ({
        id: d.id,
        name: d.name,
        createdAt: d.createdAt,
        revokedAt: d.revokedAt ?? null,
      })),
    }));

    p.post("/painel/api/aparelhos/:id/revogar", async (req, reply) => {
      const id = (req.params as { id: string }).id;
      const devices = await loadDevices(deps.stateDir);
      const d = devices.find((x) => x.id === id);
      if (!d) return reply.code(404).send({ error: "nao_encontrado" });
      if (!d.revokedAt) {
        d.revokedAt = new Date(now()).toISOString();
        await saveDevices(deps.stateDir, devices);
        await audit(deps.stateDir, now(), { event: "device_revoked", deviceId: id, via: "painel" });
      }
      return { ok: true };
    });

    p.get("/painel/api/pastas", async () => {
      const cfg = await loadConfig(deps.stateDir);
      const pastas = [];
      for (const f of cfg.folders) {
        pastas.push({
          id: f.id,
          name: f.name,
          path: f.path, // só aparece no painel local, nunca vai para o celular
          padrao: f.id === cfg.defaultFolder,
          problema: await checkFolderPath(f.path, forbidden),
        });
      }
      return { pastas };
    });

    p.get("/painel/api/log", async () => {
      const text = await readFile(join(deps.stateDir, FILES.audit), "utf8").catch(() => "");
      const linhas = text.trim().split("\n").filter(Boolean).slice(-150).reverse();
      return {
        log: linhas.map((l) => {
          try {
            return JSON.parse(l) as Record<string, unknown>;
          } catch {
            return { event: "linha_ilegivel" };
          }
        }),
      };
    });
  });
}
