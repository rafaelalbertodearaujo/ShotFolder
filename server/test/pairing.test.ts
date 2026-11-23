import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildFoldersCanonical, foldersHeaders, parsePairUri, ROUTES } from "@shotfolder/protocol";
import { pairCode } from "@shotfolder/protocol/node";
import type { FastifyInstance } from "fastify";
import { buildAdminApp } from "../src/admin.js";
import { buildApp, createPairing } from "../src/app.js";
import type { Pairing } from "../src/pairing.js";
import { FILES, loadConfig, loadDevices, saveDevices, updateConfig } from "../src/state.js";

const ADMIN_PORT = 47801;
const TOKEN = "token-de-admin-de-teste";
const ADMIN_HEADERS = { host: `127.0.0.1:${ADMIN_PORT}`, authorization: `Bearer ${TOKEN}` };

let base: string;
let stateDir: string;
let agora: number;
let pairing: Pairing;
let app: FastifyInstance;
let admin: FastifyInstance;

function novaChave() {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return { privateKey, spki: publicKey.export({ format: "der", type: "spki" }).toString("base64") };
}

async function iniciar(): Promise<string> {
  const res = await admin.inject({ method: "POST", url: "/admin/pair/start", headers: ADMIN_HEADERS });
  expect(res.statusCode).toBe(200);
  const info = parsePairUri((res.json() as { uri: string }).uri);
  expect(info).not.toBeNull();
  return info!.token;
}

function celularPede(token: string, spki: string, deviceName = "Galaxy de teste") {
  return app.inject({ method: "POST", url: ROUTES.pair, payload: { token, publicKey: spki, deviceName } });
}

async function statusAdmin() {
  return (await admin.inject({ method: "GET", url: "/admin/pair/status", headers: ADMIN_HEADERS })).json() as {
    phase: string;
    code?: string;
    deviceName?: string;
  };
}

/** Espera o pedido do celular chegar ao estado "confirmando". */
async function esperarConfirmacao() {
  for (let i = 0; i < 50; i++) {
    const st = await statusAdmin();
    if (st.phase === "confirming") return st;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("não chegou a confirmar");
}

const confirmar = (accept: boolean) =>
  admin.inject({ method: "POST", url: "/admin/pair/confirm", headers: ADMIN_HEADERS, payload: { accept } });

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "shotfolder-pair-"));
  stateDir = join(base, "estado");
  await mkdir(stateDir);
  await mkdir(join(base, "destino"));
  await writeFile(
    join(stateDir, FILES.config),
    JSON.stringify({ folders: [{ id: "docs", name: "Docs", path: join(base, "destino") }], defaultFolder: "docs" }),
  );
  agora = Date.now();
  pairing = createPairing(stateDir, () => agora, 300);
  app = await buildApp({ stateDir, now: () => agora, pairing, forbiddenRoots: [] });
  admin = await buildAdminApp({
    stateDir,
    token: TOKEN,
    adminPort: ADMIN_PORT,
    publicHost: "100.101.102.103",
    publicPort: 47800,
    pairing,
    now: () => agora,
  });
});

afterEach(async () => {
  pairing.cancel();
  await app.close();
  await admin.close();
  await rm(base, { recursive: true, force: true });
});

describe("pareamento completo", () => {
  it("QR → celular → código igual → aceito → aparelho consegue listar pastas", async () => {
    const token = await iniciar();
    const celular = novaChave();
    const pedido = celularPede(token, celular.spki);

    const st = await esperarConfirmacao();
    expect(st.deviceName).toBe("Galaxy de teste");
    expect(st.code).toBe(pairCode(token, celular.spki)); // o mesmo que o celular mostra

    expect((await confirmar(true)).statusCode).toBe(200);
    const res = await pedido;
    expect(res.statusCode).toBe(201);
    const { deviceId } = res.json() as { deviceId: string };

    const devices = await loadDevices(stateDir);
    expect(devices).toHaveLength(1);
    expect(devices[0]).toMatchObject({ id: deviceId, name: "Galaxy de teste", publicKey: celular.spki });

    // Já pareado: a listagem de pastas assinada funciona.
    const f = { deviceId, requestId: randomUUID(), timestamp: String(agora) };
    const sig = sign("sha256", Buffer.from(buildFoldersCanonical(f)), { key: celular.privateKey, dsaEncoding: "der" });
    const pastas = await app.inject({
      method: "GET",
      url: ROUTES.folders,
      headers: foldersHeaders(f, sig.toString("base64")),
    });
    expect(pastas.statusCode).toBe(200);

    // Revogado: 401 na hora.
    await saveDevices(stateDir, devices.map((d) => ({ ...d, revokedAt: new Date(agora).toISOString() })));
    const f2 = { ...f, requestId: randomUUID() };
    const sig2 = sign("sha256", Buffer.from(buildFoldersCanonical(f2)), { key: celular.privateKey, dsaEncoding: "der" });
    const depois = await app.inject({ method: "GET", url: ROUTES.folders, headers: foldersHeaders(f2, sig2.toString("base64")) });
    expect(depois.statusCode).toBe(401);
  });

  it("recusado no PC: 403 e nenhum aparelho gravado", async () => {
    const token = await iniciar();
    const pedido = celularPede(token, novaChave().spki);
    await esperarConfirmacao();
    await confirmar(false);
    expect((await pedido).statusCode).toBe(403);
    expect(await loadDevices(stateDir)).toEqual([]);
  });

  it("ninguém confirma a tempo: 408", async () => {
    const token = await iniciar();
    const res = await celularPede(token, novaChave().spki);
    expect(res.statusCode).toBe(408);
    expect(await loadDevices(stateDir)).toEqual([]);
  });
});

describe("QR recusado", () => {
  it("expirado: 410", async () => {
    const token = await iniciar();
    agora += 2 * 60_000 + 1;
    expect((await celularPede(token, novaChave().spki)).statusCode).toBe(410);
  });

  it("reutilizado enquanto o primeiro espera: 409; depois de usado: 404", async () => {
    const token = await iniciar();
    const primeiro = celularPede(token, novaChave().spki);
    await esperarConfirmacao();
    expect((await celularPede(token, novaChave().spki)).statusCode).toBe(409);
    await confirmar(true);
    expect((await primeiro).statusCode).toBe(201);
    expect((await celularPede(token, novaChave().spki)).statusCode).toBe(404);
    expect(await loadDevices(stateDir)).toHaveLength(1);
  });

  it("token errado: 401", async () => {
    await iniciar();
    expect((await celularPede("x".repeat(43), novaChave().spki)).statusCode).toBe(401);
  });

  it("QR novo invalida o anterior", async () => {
    const antigo = await iniciar();
    await iniciar();
    expect((await celularPede(antigo, novaChave().spki)).statusCode).toBe(401);
  });

  it("sem pareamento aberto: 404", async () => {
    expect((await celularPede("x".repeat(43), novaChave().spki)).statusCode).toBe(404);
  });

  it("chave que não é P-256: 400", async () => {
    const token = await iniciar();
    const ed = generateKeyPairSync("ed25519").publicKey.export({ format: "der", type: "spki" }).toString("base64");
    expect((await celularPede(token, ed)).statusCode).toBe(400);
    expect((await celularPede(token, "lixo")).statusCode).toBe(400);
  });

  it("nome com HTML ou quebra de linha: 400", async () => {
    const token = await iniciar();
    expect((await celularPede(token, novaChave().spki, "<script>")).statusCode).toBe(400);
    expect((await celularPede(token, novaChave().spki, "a\nb")).statusCode).toBe(400);
  });

  it("campo a mais no corpo: 400", async () => {
    const token = await iniciar();
    const res = await app.inject({
      method: "POST",
      url: ROUTES.pair,
      payload: { token, publicKey: novaChave().spki, deviceName: "x", admin: true },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("API admin", () => {
  it.each([
    ["sem token", { host: ADMIN_HEADERS.host }],
    ["token errado", { ...ADMIN_HEADERS, authorization: "Bearer outro" }],
    ["Host diferente (DNS rebinding)", { ...ADMIN_HEADERS, host: "evil.example:47801" }],
    ["vinda de navegador (Origin)", { ...ADMIN_HEADERS, origin: "https://evil.example" }],
  ])("recusa %s", async (_n, headers) => {
    const res = await admin.inject({ method: "POST", url: "/admin/pair/start", headers });
    expect(res.statusCode).toBe(403);
    expect(pairing.status()).toEqual({ phase: "none" });
    const log = await readFile(join(stateDir, FILES.audit), "utf8");
    expect(log).toContain("admin_rejected");
  });

  it("o QR leva o IP do Tailscale e a porta pública", async () => {
    const res = await admin.inject({ method: "POST", url: "/admin/pair/start", headers: ADMIN_HEADERS });
    expect((res.json() as { uri: string }).uri).toMatch(/^shotfolder:\/\/pair\?v=1&host=100\.101\.102\.103&port=47800&t=/);
  });

  it("confirmar sem pedido pendente: 409", async () => {
    expect((await confirmar(true)).statusCode).toBe(409);
  });
});

describe("alteração de config", () => {
  it("mudança inválida não é gravada", async () => {
    const antes = await readFile(join(stateDir, FILES.config), "utf8");
    await expect(
      updateConfig(stateDir, (raw) => {
        raw.folders = [...(raw.folders ?? []), { id: "../x", name: "x", path: "C:\\x" }];
      }),
    ).rejects.toThrow();
    expect(await readFile(join(stateDir, FILES.config), "utf8")).toBe(antes);
    expect((await loadConfig(stateDir)).folders).toHaveLength(1);
  });
});
