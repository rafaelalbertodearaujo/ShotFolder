import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildAdminApp } from "../src/admin.js";
import { createPairing } from "../src/app.js";
import { isProcessAlive, nextDelay } from "../src/daemon.js";
import { launchCommand, quoteArgs } from "../src/startup.js";

describe("vigia", () => {
  it("espera cada vez mais entre tentativas, até 60 s", () => {
    expect([0, 1, 2, 3, 4, 50].map(nextDelay)).toEqual([5000, 10000, 30000, 60000, 60000, 60000]);
  });
  it("sabe se um processo está vivo", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
    expect(isProcessAlive(0)).toBe(false);
    expect(isProcessAlive(-5)).toBe(false);
    expect(isProcessAlive(2 ** 30)).toBe(false);
  });
});

describe("atalho de inicialização", () => {
  it("roda o Node sem janela pelo conhost --headless, no modo vigia", () => {
    const cmd = launchCommand([]);
    expect(cmd.target.toLowerCase()).toMatch(/system32\\conhost\.exe$/);
    expect(cmd.args[0]).toBe("--headless");
    expect(cmd.args[1]).toBe(process.execPath);
    expect(cmd.args[2]).toMatch(/cli\.js$/);
    expect(cmd.args[3]).toBe("daemon");
    expect(launchCommand(["--local"]).args.at(-1)).toBe("--local");
  });
  it("põe aspas em caminhos com espaço", () => {
    expect(quoteArgs(["--headless", "C:\Program Files\nodejs\node.exe", "daemon"])).toBe(
      '--headless "C:\Program Files\nodejs\node.exe" daemon',
    );
  });
});

describe("API admin: status e desligar", () => {
  let base: string;
  let admin: FastifyInstance;
  let desligou = 0;
  const H = { host: "127.0.0.1:47801", authorization: "Bearer t" };

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), "shotfolder-daemon-"));
    await mkdir(join(base, "tmp"));
    desligou = 0;
    admin = await buildAdminApp({
      stateDir: base,
      token: "t",
      adminPort: 47801,
      publicHost: "100.101.102.103",
      publicPort: 47800,
      pairing: createPairing(base),
      onShutdown: () => desligou++,
    });
  });
  afterEach(async () => {
    await admin.close();
    await rm(base, { recursive: true, force: true });
  });

  it("status mostra endereço e pid", async () => {
    const r = await admin.inject({ method: "GET", url: "/admin/status", headers: H });
    expect(r.json()).toMatchObject({ pid: process.pid, host: "100.101.102.103", port: 47800 });
  });
  it("shutdown exige token e chama o desligamento", async () => {
    expect((await admin.inject({ method: "POST", url: "/admin/shutdown", headers: { host: H.host } })).statusCode).toBe(403);
    expect(desligou).toBe(0);
    expect((await admin.inject({ method: "POST", url: "/admin/shutdown", headers: H })).statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 120));
    expect(desligou).toBe(1);
  });
});
