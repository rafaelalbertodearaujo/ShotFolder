/**
 * Teste de integração: o código do app (crypto + api) conversando com o servidor
 * de verdade, por HTTP em 127.0.0.1. Só a câmera e o SecureStore ficam de fora.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp, createPairing } from "../../server/src/app";
import type { Pairing } from "../../server/src/pairing";
import { saveDevices, loadDevices } from "../../server/src/state";
import { ApiError, listFolders, pairWithPc, safeDeviceName, uploadPhoto, type Session } from "../src/lib/api";
import { pairCodeFor, SoftwareSigner } from "../src/lib/crypto";
import { stripJpegMetadata } from "../src/lib/jpeg";
import { APP0, APP1_EXIF, DQT, jpegCom, SCAN } from "./jpeg-fixture";

const aleatorio = (n: number) => new Uint8Array(randomBytes(n));
const ids = { now: Date.now, uuid: randomUUID };

let base: string;
let stateDir: string;
let pairing: Pairing;
let app: FastifyInstance;
let port: number;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "shotfolder-app-"));
  stateDir = join(base, "estado");
  await mkdir(stateDir);
  await mkdir(join(base, "fotos"));
  await writeFile(
    join(stateDir, "config.json"),
    JSON.stringify({ folders: [{ id: "fotos", name: "Fotos do projeto", path: join(base, "fotos") }], defaultFolder: "fotos" }),
  );
  pairing = createPairing(stateDir, Date.now, 2000);
  app = await buildApp({ stateDir, pairing, forbiddenRoots: [] });
  await app.listen({ host: "127.0.0.1", port: 0 });
  port = (app.server.address() as AddressInfo).port;
});

afterEach(async () => {
  pairing.cancel();
  await app.close();
  await rm(base, { recursive: true, force: true });
});

/** Faz o papel de você no PC: espera o pedido e confere o código antes de aceitar. */
async function pcConfirma(codigoEsperado: string, aceitar = true) {
  for (let i = 0; i < 100; i++) {
    const st = pairing.status();
    if (st.phase === "confirming") {
      expect(st.code).toBe(codigoEsperado);
      return pairing.confirm(aceitar);
    }
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("pedido não chegou");
}

describe("app ↔ servidor", () => {
  it("pareia e lista as pastas", async () => {
    const { token } = pairing.start();
    const signer = SoftwareSigner.generate(aleatorio);
    const info = { host: "127.0.0.1", port, token };
    const [session] = await Promise.all([
      pairWithPc(info, signer, safeDeviceName("SM-S911B")),
      pcConfirma(pairCodeFor(token, signer.publicKeySpki)),
    ]);
    expect(session.deviceId).toMatch(/^dev_/);
    expect((await loadDevices(stateDir))[0]?.name).toBe("SM-S911B");

    const lista = await listFolders(session, signer, ids);
    expect(lista).toEqual({ folders: [{ id: "fotos", name: "Fotos do projeto" }], defaultFolder: "fotos" });
  });

  it("recusa no PC vira mensagem em português", async () => {
    const { token } = pairing.start();
    const signer = SoftwareSigner.generate(aleatorio);
    const [r] = await Promise.allSettled([
      pairWithPc({ host: "127.0.0.1", port, token }, signer, "Celular"),
      pcConfirma(pairCodeFor(token, signer.publicKeySpki), false),
    ]);
    expect(r.status).toBe("rejected");
    expect((r as PromiseRejectedResult).reason).toBeInstanceOf(ApiError);
    expect(((r as PromiseRejectedResult).reason as ApiError).code).toBe("rejected");
  });

  it("revogado no PC: listar pastas dá erro 'unauthorized'", async () => {
    const { token } = pairing.start();
    const signer = SoftwareSigner.generate(aleatorio);
    const [session] = await Promise.all([
      pairWithPc({ host: "127.0.0.1", port, token }, signer, "Celular"),
      pcConfirma(pairCodeFor(token, signer.publicKeySpki)),
    ]);
    const devices = await loadDevices(stateDir);
    await saveDevices(stateDir, devices.map((d) => ({ ...d, revokedAt: new Date().toISOString() })));
    await expect(listFolders(session, signer, ids)).rejects.toMatchObject({ code: "unauthorized" });
  });

  it("PC fora do ar: erro de rede claro", async () => {
    const signer = SoftwareSigner.generate(aleatorio);
    await expect(
      listFolders({ host: "127.0.0.1", port: 1, deviceId: "dev_xxxxxxxx" }, signer, ids),
    ).rejects.toMatchObject({ code: "network" });
  });
});

async function parear(): Promise<{ session: Session; signer: SoftwareSigner }> {
  const { token } = pairing.start();
  const signer = SoftwareSigner.generate(aleatorio);
  const [session] = await Promise.all([
    pairWithPc({ host: "127.0.0.1", port, token }, signer, "Celular"),
    pcConfirma(pairCodeFor(token, signer.publicKeySpki)),
  ]);
  return { session, signer };
}

describe("envio de foto", () => {
  it("foto sem EXIF chega na pasta escolhida, byte a byte", async () => {
    const { session, signer } = await parear();
    const jpeg = stripJpegMetadata(jpegCom(APP0, APP1_EXIF, DQT, SCAN));
    const r = await uploadPhoto(session, signer, "fotos", jpeg, ids);
    expect(r.status).toBe("saved");
    expect(r.file).toMatch(/^\d{4}-\d{2}-\d{2}_\d{6}_[0-9a-f]{4}\.jpg$/);
    const gravado = await readFile(join(base, "fotos", r.file));
    expect(new Uint8Array(gravado)).toEqual(jpeg);
    expect(gravado.includes(Buffer.from("GPS"))).toBe(false);
  });

  it("reenvio com o mesmo uploadId não duplica", async () => {
    const { session, signer } = await parear();
    const jpeg = jpegCom(APP0, DQT, SCAN);
    const uploadId = randomUUID();
    expect((await uploadPhoto(session, signer, "fotos", jpeg, ids, { uploadId })).status).toBe("saved");
    expect((await uploadPhoto(session, signer, "fotos", jpeg, ids, { uploadId })).status).toBe("duplicate");
    expect(await readdir(join(base, "fotos"))).toHaveLength(1);
  });

  it("pasta fora da lista vira mensagem clara", async () => {
    const { session, signer } = await parear();
    await expect(uploadPhoto(session, signer, "outra", jpegCom(APP0, DQT, SCAN), ids)).rejects.toMatchObject({
      code: "unknown_folder",
    });
  });

  it("arquivo que não é JPEG é recusado pelo PC", async () => {
    const { session, signer } = await parear();
    const falso = new TextEncoder().encode("<html>nao sou foto</html>");
    await expect(uploadPhoto(session, signer, "fotos", falso, ids)).rejects.toMatchObject({ code: "content_mismatch" });
    expect(await readdir(join(base, "fotos"))).toHaveLength(0);
  });

  it("acima de 25 MB nem sai do celular", async () => {
    const { session, signer } = await parear();
    await expect(
      uploadPhoto(session, signer, "fotos", new Uint8Array(25 * 1024 * 1024 + 1), ids),
    ).rejects.toMatchObject({ code: "too_large" });
  });
});

describe("nome do aparelho", () => {
  it("limpa caracteres que o PC recusaria", () => {
    expect(safeDeviceName("Galaxy S23 <Ultra>\n")).toBe("Galaxy S23 Ultra");
    expect(safeDeviceName(null)).toBe("Celular");
    expect(safeDeviceName("x".repeat(80))).toHaveLength(40);
  });
});
