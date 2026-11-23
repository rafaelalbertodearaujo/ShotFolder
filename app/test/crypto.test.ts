import { createHash, randomBytes, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildUploadCanonical, type UploadFields } from "@shotfolder/protocol";
import { importDevicePublicKey, pairCode, verifyCanonical } from "@shotfolder/protocol/node";
import { bytesToBase64, pairCodeFor, sha256Hex, SoftwareSigner } from "../src/lib/crypto";
import vetores from "../../packages/protocol/test/vetores.json";

const aleatorio = (n: number) => new Uint8Array(randomBytes(n));

describe("chave em software do app", () => {
  it("a chave pública SPKI é aceita pelo PC como P-256", () => {
    const signer = SoftwareSigner.generate(aleatorio);
    const key = importDevicePublicKey(signer.publicKeySpki);
    expect(key.asymmetricKeyDetails?.namedCurve).toBe("prime256v1");
    // mesma chave reexportada pelo Node = mesmos bytes
    expect(key.export({ format: "der", type: "spki" }).toString("base64")).toBe(signer.publicKeySpki);
  });

  it("a assinatura do app confere no verificador do PC", async () => {
    const signer = SoftwareSigner.generate(aleatorio);
    const f: UploadFields = { ...(vetores.upload.fields as UploadFields), deviceId: "dev_APP_TESTE" };
    const canonical = buildUploadCanonical(f);
    const sig = await signer.sign(canonical);
    const key = importDevicePublicKey(signer.publicKeySpki);
    expect(verifyCanonical(key, canonical, sig)).toBe(true);
    expect(verifyCanonical(key, canonical + "x", sig)).toBe(false);
    expect(verify("sha256", Buffer.from(canonical), { key, dsaEncoding: "der" }, Buffer.from(sig, "base64"))).toBe(true);
  });

  it("guardar e recarregar a chave mantém a mesma identidade", async () => {
    const a = SoftwareSigner.generate(aleatorio);
    const b = SoftwareSigner.fromSecretHex(a.secretHex());
    expect(b.publicKeySpki).toBe(a.publicKeySpki);
  });

  it("o app assina com a chave de teste dos vetores e o PC confere", async () => {
    // A chave PKCS8 do vetor tem o segredo nos últimos bytes do bloco "04 20 <32 bytes>".
    const der = Buffer.from(vetores.privateKeyPkcs8, "base64");
    const i = der.indexOf(Buffer.from([0x04, 0x20]));
    const signer = SoftwareSigner.fromSecretHex(der.subarray(i + 2, i + 34).toString("hex"));
    expect(signer.publicKeySpki).toBe(vetores.publicKeySpki);
    const sig = await signer.sign(vetores.upload.canonical);
    expect(verifyCanonical(importDevicePublicKey(vetores.publicKeySpki), vetores.upload.canonical, sig)).toBe(true);
  });
});

describe("utilitários", () => {
  it("base64 igual ao do Node", () => {
    for (let n = 0; n < 40; n++) {
      const b = aleatorio(n);
      expect(bytesToBase64(b)).toBe(Buffer.from(b).toString("base64"));
    }
  });
  it("SHA-256 igual ao do Node", () => {
    expect(sha256Hex("ShotFolder ç")).toBe(createHash("sha256").update("ShotFolder ç", "utf8").digest("hex"));
  });
  it("código de pareamento igual ao do PC", () => {
    const token = randomBytes(32).toString("base64url");
    const spki = SoftwareSigner.generate(aleatorio).publicKeySpki;
    expect(pairCodeFor(token, spki)).toBe(pairCode(token, spki));
  });
});
