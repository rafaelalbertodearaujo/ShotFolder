/**
 * Etapa 6 sem o celular: o KeystoreSigner com um "Keystore falso" que se comporta como
 * o módulo Kotlin (P-256, SHA256withECDSA em DER, SPKI em base64, recusa com tela
 * bloqueada), pareando e enviando contra o servidor de verdade.
 */
import { generateKeyPairSync, randomUUID, sign, type KeyObject } from "node:crypto";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp, createPairing } from "../../server/src/app";
import type { Pairing } from "../../server/src/pairing";
import { loadDevices } from "../../server/src/state";
import { ApiError, listFolders, pairWithPc, uploadPhoto } from "../src/lib/api";
import { pairCodeFor } from "../src/lib/crypto";
import { KeyLockedError, KeystoreSigner, securityLevelLabel, type KeystoreNative } from "../src/lib/keystore-signer";
import { APP0, DQT, jpegCom, SCAN } from "./jpeg-fixture";

/** Imita o ShotfolderKeystoreModule.kt. */
class KeystoreFalso implements KeystoreNative {
  chaves = new Map<string, KeyObject>();
  publicas = new Map<string, string>();
  bloqueado = false;
  hasKey = (a: string) => this.chaves.has(a);
  async generateKey(a: string) {
    const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    this.chaves.set(a, privateKey);
    this.publicas.set(a, publicKey.export({ format: "der", type: "spki" }).toString("base64"));
    return { publicKeySpki: this.publicas.get(a)!, securityLevel: "strongbox" as const };
  }
  getPublicKey = (a: string) => this.publicas.get(a)!;
  getSecurityLevel = () => "strongbox" as const;
  async sign(a: string, text: string) {
    if (this.bloqueado) throw new Error("ERR_KEY_LOCKED");
    return sign("sha256", Buffer.from(text, "utf8"), { key: this.chaves.get(a)!, dsaEncoding: "der" }).toString("base64");
  }
  deleteKey = (a: string) => {
    this.chaves.delete(a);
    this.publicas.delete(a);
  };
}

const ids = { now: Date.now, uuid: randomUUID };
let base: string;
let pairing: Pairing;
let app: FastifyInstance;
let port: number;
let ks: KeystoreFalso;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "shotfolder-ks-"));
  await mkdir(join(base, "estado"));
  await mkdir(join(base, "fotos"));
  await writeFile(
    join(base, "estado", "config.json"),
    JSON.stringify({ folders: [{ id: "fotos", name: "Fotos", path: join(base, "fotos") }], defaultFolder: "fotos" }),
  );
  pairing = createPairing(join(base, "estado"), Date.now, 2000);
  app = await buildApp({ stateDir: join(base, "estado"), pairing, forbiddenRoots: [] });
  await app.listen({ host: "127.0.0.1", port: 0 });
  port = (app.server.address() as AddressInfo).port;
  ks = new KeystoreFalso();
});

afterEach(async () => {
  pairing.cancel();
  await app.close();
  await rm(base, { recursive: true, force: true });
});

async function parear(signer: KeystoreSigner) {
  const { token } = pairing.start();
  const confirmar = (async () => {
    for (let i = 0; i < 100; i++) {
      const st = pairing.status();
      if (st.phase === "confirming") {
        expect(st.code).toBe(pairCodeFor(token, signer.publicKeySpki));
        return pairing.confirm(true);
      }
      await new Promise((r) => setTimeout(r, 10));
    }
  })();
  const [session] = await Promise.all([pairWithPc({ host: "127.0.0.1", port, token }, signer, "Galaxy"), confirmar]);
  return session;
}

describe("chave no Keystore", () => {
  it("pareia, lista pastas e envia foto com a chave do Keystore", async () => {
    const signer = await KeystoreSigner.create(ks, "shotfolder-device-a");
    expect(signer.securityLevel).toBe("strongbox");
    const session = await parear(signer);
    const devices = await loadDevices(join(base, "estado"));
    expect(devices[0]?.publicKey).toBe(signer.publicKeySpki);
    expect((await listFolders(session, signer, ids)).folders).toHaveLength(1);
    expect((await uploadPhoto(session, signer, "fotos", jpegCom(APP0, DQT, SCAN), ids)).status).toBe("saved");
  });

  it("celular bloqueado: o envio falha com 'key_locked' e nada chega no PC", async () => {
    const signer = await KeystoreSigner.create(ks, "shotfolder-device-a");
    const session = await parear(signer);
    ks.bloqueado = true;
    await expect(uploadPhoto(session, signer, "fotos", jpegCom(APP0, DQT, SCAN), ids)).rejects.toMatchObject({
      code: "key_locked",
    });
    expect(await readdir(join(base, "fotos"))).toHaveLength(0);
    await expect(signer.sign("x")).rejects.toBeInstanceOf(KeyLockedError);
  });

  it("reabre a mesma chave pelo apelido; chave apagada = precisa parear de novo", async () => {
    const a = await KeystoreSigner.create(ks, "shotfolder-device-a");
    expect(KeystoreSigner.load(ks, "shotfolder-device-a")?.publicKeySpki).toBe(a.publicKeySpki);
    a.destroy();
    expect(KeystoreSigner.load(ks, "shotfolder-device-a")).toBeNull();
  });

  it("chave nova (re-pareamento) com a antiga revogada: a antiga é recusada", async () => {
    const antiga = await KeystoreSigner.create(ks, "shotfolder-device-a");
    const s1 = await parear(antiga);
    const nova = await KeystoreSigner.create(ks, "shotfolder-device-b");
    const s2 = await parear(nova);
    // o PC revoga o aparelho antigo
    const { saveDevices } = await import("../../server/src/state");
    const devices = await loadDevices(join(base, "estado"));
    await saveDevices(
      join(base, "estado"),
      devices.map((d) => (d.id === s1.deviceId ? { ...d, revokedAt: new Date().toISOString() } : d)),
    );
    await expect(listFolders(s1, antiga, ids)).rejects.toBeInstanceOf(ApiError);
    expect((await listFolders(s2, nova, ids)).folders).toHaveLength(1);
  });

  it("rótulos em português para o nível de segurança", () => {
    expect(securityLevelLabel("strongbox")).toContain("StrongBox");
    expect(securityLevelLabel("tee")).toContain("TEE");
  });
});
