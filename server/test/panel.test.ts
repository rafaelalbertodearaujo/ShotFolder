import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildAdminApp } from "../src/admin.js";
import { createPairing } from "../src/app.js";
import { COOKIE } from "../src/panel.js";
import { FILES, loadDevices, saveDevices, SeenStore } from "../src/state.js";

const PORT = 47801;
const HOST = `127.0.0.1:${PORT}`;
const ADMIN = { host: HOST, authorization: "Bearer tok" };
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

let base: string;
let fotos: string;
let seen: SeenStore;
let admin: FastifyInstance;
let lixeira: string[];
let mostrados: string[];

async function gravarFoto(file: string, folderId = "docs"): Promise<string> {
  const id = randomUUID();
  await writeFile(join(fotos, file), JPEG);
  await seen.add(id, { deviceId: "dev_TESTE_0001", folderId, file, at: new Date().toISOString(), bytes: JPEG.length }, Date.now());
  return id;
}

/** Faz login como o navegador faria: código da CLI → cookie. */
async function entrar(): Promise<{ cookie: string; csrf: string }> {
  const { code } = (await admin.inject({ method: "POST", url: "/admin/panel/session", headers: ADMIN })).json() as { code: string };
  const r = await admin.inject({ method: "GET", url: `/painel/entrar?c=${code}`, headers: { host: HOST } });
  expect(r.statusCode).toBe(302);
  const setCookie = String(r.headers["set-cookie"]);
  expect(setCookie).toMatch(/HttpOnly/);
  expect(setCookie).toMatch(/SameSite=Strict/);
  const cookie = setCookie.split(";")[0]!;
  const s = (await admin.inject({ method: "GET", url: "/painel/api/sessao", headers: { host: HOST, cookie } })).json() as { csrf: string };
  return { cookie, csrf: s.csrf };
}

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "shotfolder-painel-"));
  const estado = join(base, "estado");
  fotos = join(base, "fotos");
  await mkdir(join(estado, "tmp"), { recursive: true });
  await mkdir(fotos);
  await writeFile(join(estado, FILES.config), JSON.stringify({ folders: [{ id: "docs", name: "Docs", path: fotos }] }));
  await saveDevices(estado, [
    { id: "dev_TESTE_0001", name: "Galaxy", publicKey: "x", createdAt: new Date().toISOString() },
  ]);
  seen = await SeenStore.open(estado);
  lixeira = [];
  mostrados = [];
  admin = await buildAdminApp({
    stateDir: estado,
    token: "tok",
    adminPort: PORT,
    publicHost: "100.101.102.103",
    publicPort: 47800,
    pairing: createPairing(estado),
    seen,
    panel: {
      forbiddenRoots: [],
      recycle: async (p) => {
        lixeira.push(p);
      },
      reveal: (p) => mostrados.push(p),
    },
  });
});

afterEach(async () => {
  await admin.close();
  await rm(base, { recursive: true, force: true });
});

describe("entrada no painel", () => {
  it("o código vale uma vez só", async () => {
    const { code } = (await admin.inject({ method: "POST", url: "/admin/panel/session", headers: ADMIN })).json() as { code: string };
    expect((await admin.inject({ method: "GET", url: `/painel/entrar?c=${code}`, headers: { host: HOST } })).statusCode).toBe(302);
    expect((await admin.inject({ method: "GET", url: `/painel/entrar?c=${code}`, headers: { host: HOST } })).statusCode).toBe(403);
  });

  it("código inventado não entra", async () => {
    expect((await admin.inject({ method: "GET", url: "/painel/entrar?c=abc", headers: { host: HOST } })).statusCode).toBe(403);
  });

  it("só a CLI (com token) gera código", async () => {
    expect((await admin.inject({ method: "POST", url: "/admin/panel/session", headers: { host: HOST } })).statusCode).toBe(403);
  });

  it("sem sessão: página pede para rodar shotfolder painel; API dá 401", async () => {
    const pagina = await admin.inject({ method: "GET", url: "/painel/", headers: { host: HOST } });
    expect(pagina.statusCode).toBe(401);
    expect(pagina.body).toContain("shotfolder painel");
    expect((await admin.inject({ method: "GET", url: "/painel/api/fotos", headers: { host: HOST } })).statusCode).toBe(401);
  });

  it("com sessão: página e cabeçalhos de segurança", async () => {
    const { cookie } = await entrar();
    const r = await admin.inject({ method: "GET", url: "/painel/", headers: { host: HOST, cookie } });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain("ShotFolder");
    expect(r.headers["content-security-policy"]).toContain("script-src 'self'");
    expect(r.headers["x-frame-options"]).toBe("DENY");
  });

  it("Host diferente é bloqueado mesmo com cookie (DNS rebinding)", async () => {
    const { cookie } = await entrar();
    const r = await admin.inject({ method: "GET", url: "/painel/api/fotos", headers: { host: "evil.example:47801", cookie } });
    expect(r.statusCode).toBe(403);
  });
});

describe("fotos", () => {
  it("lista com pasta, aparelho e se o arquivo existe", async () => {
    await gravarFoto("2026-11-23_101010_aaaa.jpg");
    const { cookie } = await entrar();
    const r = (await admin.inject({ method: "GET", url: "/painel/api/fotos", headers: { host: HOST, cookie } })).json() as {
      fotos: Array<Record<string, unknown>>;
    };
    expect(r.fotos[0]).toMatchObject({ file: "2026-11-23_101010_aaaa.jpg", folderName: "Docs", aparelho: "Galaxy", existe: true });
  });

  it("serve a imagem com o tipo certo", async () => {
    const id = await gravarFoto("2026-11-23_101010_aaaa.jpg");
    const { cookie } = await entrar();
    const r = await admin.inject({ method: "GET", url: `/painel/api/fotos/${id}/arquivo`, headers: { host: HOST, cookie } });
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-type"]).toBe("image/jpeg");
    expect(r.rawPayload).toEqual(JPEG);
  });

  it("excluir manda para a Lixeira e marca como excluída", async () => {
    const id = await gravarFoto("2026-11-23_101010_aaaa.jpg");
    const { cookie, csrf } = await entrar();
    const r = await admin.inject({
      method: "POST",
      url: `/painel/api/fotos/${id}/excluir`,
      headers: { host: HOST, cookie, "x-sf-csrf": csrf, origin: `http://${HOST}` },
    });
    expect(r.statusCode).toBe(200);
    expect(lixeira).toEqual([join(fotos, "2026-11-23_101010_aaaa.jpg")]);
    expect(seen.get(id)?.deletedAt).toBeTruthy();
    // depois de excluída não dá para abrir nem excluir de novo
    expect((await admin.inject({ method: "GET", url: `/painel/api/fotos/${id}/arquivo`, headers: { host: HOST, cookie } })).statusCode).toBe(404);
  });

  it("excluir sem o segredo CSRF, ou vindo de outro site, é bloqueado", async () => {
    const id = await gravarFoto("2026-11-23_101010_aaaa.jpg");
    const { cookie, csrf } = await entrar();
    const semCsrf = await admin.inject({ method: "POST", url: `/painel/api/fotos/${id}/excluir`, headers: { host: HOST, cookie } });
    expect(semCsrf.statusCode).toBe(403);
    const outroSite = await admin.inject({
      method: "POST",
      url: `/painel/api/fotos/${id}/excluir`,
      headers: { host: HOST, cookie, "x-sf-csrf": csrf, origin: "https://evil.example" },
    });
    expect(outroSite.statusCode).toBe(403);
    const crossSite = await admin.inject({
      method: "POST",
      url: `/painel/api/fotos/${id}/excluir`,
      headers: { host: HOST, cookie, "x-sf-csrf": csrf, "sec-fetch-site": "cross-site" },
    });
    expect(crossSite.statusCode).toBe(403);
    expect(lixeira).toEqual([]);
  });

  it("só exclui fotos que o ShotFolder gravou", async () => {
    await writeFile(join(fotos, "documento-importante.pdf"), "x");
    const { cookie, csrf } = await entrar();
    const h = { host: HOST, cookie, "x-sf-csrf": csrf };
    // id que não existe, id que não é UUID, caminho no lugar do id
    for (const id of [randomUUID(), "../../documento-importante.pdf", "..%2F..%2Fdocumento-importante.pdf"]) {
      const r = await admin.inject({ method: "POST", url: `/painel/api/fotos/${id}/excluir`, headers: h });
      expect(r.statusCode).toBe(404);
    }
    expect(lixeira).toEqual([]);
  });

  it("registro adulterado com nome fora do padrão não vira caminho", async () => {
    const id = randomUUID();
    await seen.add(id, { deviceId: "dev_TESTE_0001", folderId: "docs", file: "..\\..\\Windows\\win.ini", at: new Date().toISOString() }, Date.now());
    const { cookie, csrf } = await entrar();
    const r = await admin.inject({ method: "POST", url: `/painel/api/fotos/${id}/excluir`, headers: { host: HOST, cookie, "x-sf-csrf": csrf } });
    expect(r.statusCode).toBe(404);
    expect(lixeira).toEqual([]);
  });

  it("mostrar na pasta abre o Explorer no arquivo", async () => {
    const id = await gravarFoto("2026-11-23_101010_aaaa.jpg");
    const { cookie, csrf } = await entrar();
    await admin.inject({ method: "POST", url: `/painel/api/fotos/${id}/mostrar`, headers: { host: HOST, cookie, "x-sf-csrf": csrf } });
    expect(mostrados).toEqual([join(fotos, "2026-11-23_101010_aaaa.jpg")]);
  });
});

describe("aparelhos, pastas e registro", () => {
  it("revogar pelo painel", async () => {
    const { cookie, csrf } = await entrar();
    const r = await admin.inject({
      method: "POST",
      url: "/painel/api/aparelhos/dev_TESTE_0001/revogar",
      headers: { host: HOST, cookie, "x-sf-csrf": csrf },
    });
    expect(r.statusCode).toBe(200);
    const estado = join(base, "estado");
    expect((await loadDevices(estado))[0]?.revokedAt).toBeTruthy();
  });

  it("pastas e registro respondem", async () => {
    const { cookie } = await entrar();
    const pastas = (await admin.inject({ method: "GET", url: "/painel/api/pastas", headers: { host: HOST, cookie } })).json() as {
      pastas: Array<{ id: string; problema: string | null }>;
    };
    expect(pastas.pastas).toEqual([expect.objectContaining({ id: "docs", problema: null })]);
    const log = (await admin.inject({ method: "GET", url: "/painel/api/log", headers: { host: HOST, cookie } })).json() as {
      log: Array<{ event: string }>;
    };
    expect(log.log[0]?.event).toBe("panel_login");
  });
});
