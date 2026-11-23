import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkFolderPath, defaultForbiddenRoots, generateFileName, sniffImageType } from "../src/files.js";
import { isTailscaleIPv4 } from "../src/net.js";

let base: string;
beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), "shotfolder-files-"));
});
afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

describe("pastas permitidas", () => {
  it("aceita pasta comum", async () => {
    expect(await checkFolderPath(base, [])).toBeNull();
  });

  it.each([
    ["raiz de disco", "C:\\"],
    ["caminho de rede", "\\\\servidor\\compartilhado"],
    ["pasta inexistente", "C:\\nao\\existe\\shotfolder"],
  ])("recusa %s", async (_n, p) => {
    expect(await checkFolderPath(p, [])).not.toBeNull();
  });

  it("recusa arquivo no lugar de pasta", async () => {
    const f = join(base, "arquivo.txt");
    await writeFile(f, "x");
    expect(await checkFolderPath(f, [])).toBe("não é uma pasta");
  });

  it("recusa pastas do sistema e a própria pasta de estado", async () => {
    const proibidas = defaultForbiddenRoots(join(base, "estado"));
    for (const p of [
      process.env.SystemRoot ?? "C:\\Windows",
      join(process.env.APPDATA ?? "C:\\x", "Microsoft\\Windows\\Start Menu\\Programs\\Startup"),
      join(base, "estado"),
    ]) {
      expect(await checkFolderPath(p, proibidas)).toBe("pasta do sistema ou do programa");
    }
  });

  it("não confunde prefixo de nome (C:\\Windows2 não é C:\\Windows)", async () => {
    expect(await checkFolderPath(base, [base + "x"])).toBeNull();
  });
});

describe("tipo real do arquivo", () => {
  it("reconhece JPEG, PNG e WEBP pelos primeiros bytes", () => {
    expect(sniffImageType(Buffer.from([0xff, 0xd8, 0xff, 0xdb]))).toBe("image/jpeg");
    expect(sniffImageType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
    expect(sniffImageType(Buffer.from("RIFF\x00\x00\x00\x00WEBPVP8 ", "latin1"))).toBe("image/webp");
  });
  it("recusa o resto", () => {
    expect(sniffImageType(Buffer.from("MZ\x90\x00", "latin1"))).toBeNull(); // executável
    expect(sniffImageType(Buffer.from("<svg"))).toBeNull();
    expect(sniffImageType(Buffer.alloc(0))).toBeNull();
  });
});

describe("nome gerado", () => {
  it("só tem caracteres seguros", () => {
    const nome = generateFileName(Date.now(), "image/jpeg");
    expect(nome).toMatch(/^\d{4}-\d{2}-\d{2}_\d{6}_[0-9a-f]{4}\.jpg$/);
  });
});

describe("IP do Tailscale", () => {
  it.each(["100.64.0.1", "100.101.102.103", "100.127.255.255"])("aceita %s", (ip) => {
    expect(isTailscaleIPv4(ip)).toBe(true);
  });
  it.each(["0.0.0.0", "127.0.0.1", "192.168.0.10", "100.63.0.1", "100.128.0.1", "100.64.0.999", "::"])(
    "recusa %s",
    (ip) => {
      expect(isTailscaleIPv4(ip)).toBe(false);
    },
  );
});
