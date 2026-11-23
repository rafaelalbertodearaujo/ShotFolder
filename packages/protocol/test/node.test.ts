import { createHash, createPrivateKey, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildFoldersCanonical,
  buildUploadCanonical,
  foldersHeaders,
  LIMITS,
  uploadHeaders,
  type FoldersFields,
  type UploadFields,
} from "../src/index.js";
import { authenticateFolders, authenticateUpload, importDevicePublicKey, verifyCanonical } from "../src/node.js";
import vetores from "./vetores.json" with { type: "json" };

const agora = 1_795_000_000_000;

function novaChave() {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const spki = publicKey.export({ format: "der", type: "spki" }).toString("base64");
  return { privateKey, spki };
}
const assinar = (key: KeyObject, s: string) =>
  sign("sha256", Buffer.from(s, "utf8"), { key, dsaEncoding: "der" }).toString("base64");

const aparelho = novaChave();
const chavePublica = importDevicePublicKey(aparelho.spki);
const corpo = Buffer.from("bytes de uma foto");
const campos: UploadFields = {
  deviceId: "dev_TESTE_0001",
  uploadId: "3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b",
  timestamp: String(agora),
  folderId: "shotfolder-docs",
  contentType: "image/jpeg",
  contentLength: String(corpo.length),
  sha256: createHash("sha256").update(corpo).digest("hex"),
};
const opcoes = {
  nowMs: agora,
  getPublicKey: (id: string) => (id === campos.deviceId ? chavePublica : undefined),
};
const assinado = (f: UploadFields = campos) => uploadHeaders(f, assinar(aparelho.privateKey, buildUploadCanonical(f)));

describe("vetores fixos", () => {
  it("a assinatura do vetor de envio confere", () => {
    const key = importDevicePublicKey(vetores.publicKeySpki);
    expect(verifyCanonical(key, vetores.upload.canonical, vetores.upload.signature)).toBe(true);
    expect(verifyCanonical(key, vetores.folders.canonical, vetores.folders.signature)).toBe(true);
  });

  it("o SHA-256 do vetor é o do corpo", () => {
    const sha = createHash("sha256").update(vetores.bodyUtf8, "utf8").digest("hex");
    expect(sha).toBe(vetores.upload.fields.sha256);
  });

  it("a chave privada de teste corresponde à pública", () => {
    const priv = createPrivateKey({ key: Buffer.from(vetores.privateKeyPkcs8, "base64"), format: "der", type: "pkcs8" });
    const key = importDevicePublicKey(vetores.publicKeySpki);
    expect(verifyCanonical(key, "x", assinar(priv, "x"))).toBe(true);
  });
});

describe("autenticação de envio", () => {
  it("aceita assinatura válida", () => {
    expect(authenticateUpload(assinado(), opcoes)).toEqual({ ok: true, value: campos });
  });

  // Troca um campo DEPOIS de assinar: simula alteração no caminho.
  it.each([
    ["deviceId", "dev_TESTE_0001"],
    ["uploadId", "aaaaaaaa-9a4d-4e6f-8b7a-1c2d3e4f5a6b"],
    ["timestamp", String(agora + 1)],
    ["folderId", "outra-pasta"],
    ["contentType", "image/png"],
    ["contentLength", String(corpo.length + 1)],
    ["sha256", "b".repeat(64)],
  ] as const)("recusa %s alterado", (campo, valor) => {
    const headers = assinado();
    const alterado = { ...campos, [campo]: valor } as UploadFields;
    if (campo === "deviceId") {
      // Mesmo aparelho, mas assinatura de outra chave.
      const outra = novaChave();
      const h = uploadHeaders(campos, assinar(outra.privateKey, buildUploadCanonical(campos)));
      expect(authenticateUpload(h, opcoes)).toEqual({ ok: false, error: "bad_signature" });
      return;
    }
    const trocados = { ...uploadHeaders(alterado, headers["x-sf-signature"]!) };
    expect(authenticateUpload(trocados, opcoes)).toEqual({ ok: false, error: "bad_signature" });
  });

  it("recusa horário fora da janela antes de olhar a assinatura", () => {
    const velho = { ...campos, timestamp: String(agora - LIMITS.clockSkewMs - 1) };
    expect(authenticateUpload(assinado(velho), opcoes)).toEqual({ ok: false, error: "clock_skew" });
  });

  it("recusa aparelho desconhecido ou revogado", () => {
    const h = assinado();
    expect(authenticateUpload(h, { ...opcoes, getPublicKey: () => undefined })).toEqual({
      ok: false,
      error: "unknown_device",
    });
  });

  it("recusa assinatura que é lixo sem lançar erro", () => {
    const h = { ...assinado(), "x-sf-signature": "AAAAAAAAAAAAAAAA" };
    expect(authenticateUpload(h, opcoes)).toEqual({ ok: false, error: "bad_signature" });
  });

  it("recusa assinatura da listagem de pastas usada num envio", () => {
    const f: FoldersFields = { deviceId: campos.deviceId, requestId: campos.uploadId, timestamp: campos.timestamp };
    const sigDePastas = assinar(aparelho.privateKey, buildFoldersCanonical(f));
    expect(authenticateUpload(uploadHeaders(campos, sigDePastas), opcoes)).toEqual({ ok: false, error: "bad_signature" });
  });
});

describe("autenticação da listagem de pastas", () => {
  const f: FoldersFields = {
    deviceId: "dev_TESTE_0001",
    requestId: "0a1b2c3d-4e5f-4a7b-9c8d-7e6f5a4b3c2d",
    timestamp: String(agora),
  };
  it("aceita válida e recusa requestId trocado", () => {
    const sig = assinar(aparelho.privateKey, buildFoldersCanonical(f));
    expect(authenticateFolders(foldersHeaders(f, sig), opcoes).ok).toBe(true);
    const trocado = { ...f, requestId: "1a1b2c3d-4e5f-4a7b-9c8d-7e6f5a4b3c2d" };
    expect(authenticateFolders(foldersHeaders(trocado, sig), opcoes)).toEqual({ ok: false, error: "bad_signature" });
  });
});

describe("importação de chave", () => {
  it("recusa chave que não é P-256", () => {
    const p384 = generateKeyPairSync("ec", { namedCurve: "secp384r1" }).publicKey;
    const ed = generateKeyPairSync("ed25519").publicKey;
    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey;
    for (const k of [p384, ed, rsa]) {
      const spki = k.export({ format: "der", type: "spki" }).toString("base64");
      expect(() => importDevicePublicKey(spki)).toThrow();
    }
  });
  it("recusa texto que não é base64", () => {
    expect(() => importDevicePublicKey("não é base64!")).toThrow();
  });
});
