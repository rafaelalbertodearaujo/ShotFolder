import { createHash, generateKeyPairSync, randomUUID, sign, type KeyObject } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildFoldersCanonical,
  buildUploadCanonical,
  foldersHeaders,
  ROUTES,
  uploadHeaders,
  type AllowedContentType,
  type UploadFields,
} from "@shotfolder/protocol";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { FILES, saveDevices, type Config, type Device } from "../src/state.js";

const AGORA = 1_795_000_000_000;
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.from("JFIF conteudo de teste")]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("png de teste")]);

let base: string;
let stateDir: string;
let destino: string;
let app: FastifyInstance;
let chave: KeyObject;
let avisos: string[];
const DEVICE = "dev_TESTE_0001";

async function escreverConfig(extra: Partial<Config> = {}): Promise<void> {
  const cfg = {
    port: 47800,
    folders: [{ id: "docs", name: "Documentos", path: destino }],
    defaultFolder: "docs",
    limits: { maxUploadsPerMinute: 30, maxBytesPerDay: 10 * 1024 ** 2, minFreeBytes: 0 },
    ...extra,
  };
  await writeFile(join(stateDir, FILES.config), JSON.stringify(cfg));
}

async function cadastrar(extra: Partial<Device> = {}): Promise<void> {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  chave = privateKey;
  await saveDevices(stateDir, [
    {
      id: DEVICE,
      name: "teste",
      publicKey: publicKey.export({ format: "der", type: "spki" }).toString("base64"),
      createdAt: new Date(AGORA).toISOString(),
      ...extra,
    },
  ]);
}

const assinar = (s: string, key: KeyObject = chave) =>
  sign("sha256", Buffer.from(s, "utf8"), { key, dsaEncoding: "der" }).toString("base64");

function campos(body: Buffer, troca: Partial<UploadFields> = {}): UploadFields {
  return {
    deviceId: DEVICE,
    uploadId: randomUUID(),
    timestamp: String(AGORA),
    folderId: "docs",
    contentType: "image/jpeg" as AllowedContentType,
    contentLength: String(body.length),
    sha256: createHash("sha256").update(body).digest("hex"),
    ...troca,
  };
}

function enviar(body: Buffer, f: UploadFields = campos(body), headersExtra: Record<string, string> = {}) {
  return app.inject({
    method: "POST",
    url: ROUTES.upload,
    headers: { ...uploadHeaders(f, assinar(buildUploadCanonical(f))), ...headersExtra },
    payload: body,
  });
}

const arquivosNoDestino = async () => (await readdir(destino)).sort();
const auditoria = async () =>
  (await readFile(join(stateDir, FILES.audit), "utf8"))
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as Record<string, unknown>);

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "shotfolder-teste-"));
  stateDir = join(base, "estado");
  destino = join(base, "destino");
  await mkdir(stateDir);
  await mkdir(destino);
  await escreverConfig();
  await cadastrar();
  avisos = [];
  app = await buildApp({
    stateDir,
    now: () => AGORA,
    notify: (t, b) => avisos.push(`${t}: ${b}`),
    forbiddenRoots: [],
  });
});

afterEach(async () => {
  await app.close();
  await rm(base, { recursive: true, force: true });
});

describe("envio válido", () => {
  it("grava com nome gerado pelo PC, avisa e registra no log", async () => {
    const res = await enviar(JPEG);
    expect(res.statusCode).toBe(201);
    const { file } = res.json() as { file: string };
    expect(file).toMatch(/^\d{4}-\d{2}-\d{2}_\d{6}_[0-9a-f]{4}\.jpg$/);
    expect(await arquivosNoDestino()).toEqual([file]);
    expect(await readFile(join(destino, file))).toEqual(JPEG);
    expect(avisos).toHaveLength(1);
    expect((await auditoria()).at(-1)).toMatchObject({ event: "upload_saved", deviceId: DEVICE, file });
    expect(await readdir(join(stateDir, FILES.tmp))).toEqual([]);
  });

  it("PNG ganha extensão .png", async () => {
    const res = await enviar(PNG, campos(PNG, { contentType: "image/png" }));
    expect(res.statusCode).toBe(201);
    expect((res.json() as { file: string }).file).toMatch(/\.png$/);
  });
});

describe("repetição e reenvio", () => {
  it("mesmo uploadId vira 'já recebido' e não grava de novo", async () => {
    const f = campos(JPEG);
    expect((await enviar(JPEG, f)).statusCode).toBe(201);
    // reassina com outro horário, como a fila do celular faria
    const r2 = await enviar(JPEG, { ...f, timestamp: String(AGORA + 1000) });
    expect(r2.statusCode).toBe(200);
    expect(r2.json()).toMatchObject({ status: "duplicate" });
    expect(await arquivosNoDestino()).toHaveLength(1);
  });

  it("lembra dos envios depois de reiniciar o servidor", async () => {
    const f = campos(JPEG);
    await enviar(JPEG, f);
    await app.close();
    app = await buildApp({ stateDir, now: () => AGORA, forbiddenRoots: [] });
    expect((await enviar(JPEG, f)).statusCode).toBe(200);
    expect(await arquivosNoDestino()).toHaveLength(1);
  });
});

describe("ataques e erros recusados", () => {
  it("pasta como caminho (traversal) é recusada no formato", async () => {
    for (const folderId of ["..", "..\\Windows", "docs/../x", "C:"]) {
      const res = await app.inject({
        method: "POST",
        url: ROUTES.upload,
        headers: { ...uploadHeaders(campos(JPEG), "MEUCIQDassinaturafalsa=="), "x-sf-folder": folderId },
        payload: JPEG,
      });
      expect(res.statusCode).toBe(400);
    }
    expect(await arquivosNoDestino()).toEqual([]);
  });

  it("pasta fora da lista: 404", async () => {
    const res = await enviar(JPEG, campos(JPEG, { folderId: "outra" }));
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "unknown_folder" });
  });

  it("tipo falso: diz PNG mas é JPEG", async () => {
    const res = await enviar(JPEG, campos(JPEG, { contentType: "image/png" }));
    expect(res.statusCode).toBe(415);
    expect(await arquivosNoDestino()).toEqual([]);
  });

  it("texto/HTML disfarçado de JPEG", async () => {
    const html = Buffer.from("<html><script>alert(1)</script></html>");
    const res = await enviar(html);
    expect(res.statusCode).toBe(415);
    expect(await arquivosNoDestino()).toEqual([]);
    expect(await readdir(join(stateDir, FILES.tmp))).toEqual([]);
  });

  it("SHA-256 que não bate com o corpo", async () => {
    const outro = Buffer.concat([JPEG, Buffer.from("x")]);
    const f = campos(JPEG, { sha256: createHash("sha256").update(outro).digest("hex") });
    const res = await enviar(JPEG, f);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "hash_mismatch" });
  });

  it("tamanho declarado maior que o corpo", async () => {
    const f = campos(JPEG, { contentLength: String(JPEG.length + 10) });
    const res = await enviar(JPEG, f);
    expect(res.statusCode).toBe(400);
    expect(await arquivosNoDestino()).toEqual([]);
  });

  it("arquivo acima de 25 MB é recusado antes de ler o corpo", async () => {
    // Nem dá para assinar: o próprio protocolo recusa montar a string com esse tamanho.
    const res = await app.inject({
      method: "POST",
      url: ROUTES.upload,
      headers: {
        ...uploadHeaders(campos(JPEG), "MEUCIQDassinaturafalsa=="),
        "content-length": String(25 * 1024 * 1024 + 1),
      },
      payload: JPEG,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "invalid_field" });
  });

  it("assinatura de outra chave: 401 sem detalhe, motivo no log", async () => {
    const outra = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey;
    const f = campos(JPEG);
    const res = await app.inject({
      method: "POST",
      url: ROUTES.upload,
      headers: uploadHeaders(f, assinar(buildUploadCanonical(f), outra)),
      payload: JPEG,
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "unauthorized" });
    expect((await auditoria()).at(-1)).toMatchObject({ event: "upload_rejected", reason: "bad_signature" });
  });

  it("aparelho revogado: 401", async () => {
    await cadastrar({ revokedAt: new Date(AGORA).toISOString() });
    const res = await enviar(JPEG);
    expect(res.statusCode).toBe(401);
  });

  it("horário fora da janela: 401", async () => {
    const res = await enviar(JPEG, campos(JPEG, { timestamp: String(AGORA - 6 * 60 * 1000) }));
    expect(res.statusCode).toBe(401);
  });

  it("pasta de destino que é junção: recusa", async () => {
    const real = join(base, "real");
    const juncao = join(base, "juncao");
    await mkdir(real);
    await symlink(real, juncao, "junction");
    await escreverConfig({ folders: [{ id: "docs", name: "Docs", path: juncao }] });
    const res = await enviar(JPEG);
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "folder_unavailable" });
    expect(await readdir(real)).toEqual([]);
  });

  it("pasta dentro de uma junção: recusa", async () => {
    const real = join(base, "real");
    await mkdir(join(real, "sub"), { recursive: true });
    const juncao = join(base, "juncao");
    await symlink(real, juncao, "junction");
    await escreverConfig({ folders: [{ id: "docs", name: "Docs", path: join(juncao, "sub") }] });
    expect((await enviar(JPEG)).statusCode).toBe(500);
    expect(await readdir(join(real, "sub"))).toEqual([]);
  });

  it("limite por minuto: 429", async () => {
    await escreverConfig({ limits: { maxUploadsPerMinute: 2, maxBytesPerDay: 10 * 1024 ** 2, minFreeBytes: 0 } });
    expect((await enviar(JPEG)).statusCode).toBe(201);
    expect((await enviar(JPEG)).statusCode).toBe(201);
    expect((await enviar(JPEG)).statusCode).toBe(429);
  });

  it("cota diária: 429", async () => {
    await escreverConfig({ limits: { maxUploadsPerMinute: 30, maxBytesPerDay: JPEG.length, minFreeBytes: 0 } });
    expect((await enviar(JPEG)).statusCode).toBe(201);
    expect((await enviar(JPEG)).json()).toEqual({ error: "daily_quota" });
  });

  it("espaço livre mínimo: 507", async () => {
    await escreverConfig({ limits: { maxUploadsPerMinute: 30, maxBytesPerDay: 1e12, minFreeBytes: 1e18 } });
    expect((await enviar(JPEG)).statusCode).toBe(507);
  });

  it("rota desconhecida: 404 sem detalhes", async () => {
    const res = await app.inject({ method: "GET", url: "/../../Windows/win.ini" });
    expect(res.statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: ROUTES.upload })).statusCode).toBe(404);
  });
});

describe("listagem de pastas", () => {
  it("mostra código e nome, nunca o caminho do PC", async () => {
    const f = { deviceId: DEVICE, requestId: randomUUID(), timestamp: String(AGORA) };
    const res = await app.inject({
      method: "GET",
      url: ROUTES.folders,
      headers: foldersHeaders(f, assinar(buildFoldersCanonical(f))),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ folders: [{ id: "docs", name: "Documentos" }], defaultFolder: "docs" });
    expect(res.body).not.toContain(base.replace(/\\/g, "\\\\"));
  });

  it("sem assinatura válida: 401", async () => {
    const f = { deviceId: DEVICE, requestId: randomUUID(), timestamp: String(AGORA) };
    const res = await app.inject({ method: "GET", url: ROUTES.folders, headers: foldersHeaders(f, "AAAAAAAAAAAA") });
    expect(res.statusCode).toBe(401);
  });
});
