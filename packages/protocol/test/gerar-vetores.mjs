// Gera test/vetores.json: exemplos fixos de assinatura para conferir que o
// celular e o PC montam e verificam a mesma string canônica.
// A chave privada aqui é SÓ DE TESTE, criada por este script. Nunca usar de verdade.
// Uso: node test/gerar-vetores.mjs
import { generateKeyPairSync, sign, createHash } from "node:crypto";
import { writeFileSync } from "node:fs";

const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const spki = publicKey.export({ format: "der", type: "spki" }).toString("base64");
const pkcs8 = privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");

const body = Buffer.from("foto de teste do ShotFolder");
const upload = {
  deviceId: "dev_TESTE_0001",
  uploadId: "3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b",
  timestamp: "1795000000000",
  folderId: "shotfolder-docs",
  contentType: "image/jpeg",
  contentLength: String(body.length),
  sha256: createHash("sha256").update(body).digest("hex"),
};
// Montada à mão, de propósito, para conferir o buildUploadCanonical de forma independente.
const uploadCanonical = [
  "SHOTFOLDER-V1", "POST", "/v1/upload",
  upload.deviceId, upload.uploadId, upload.timestamp, upload.folderId,
  upload.contentType, upload.contentLength, upload.sha256,
].join("\n");

const folders = {
  deviceId: "dev_TESTE_0001",
  requestId: "0a1b2c3d-4e5f-4a7b-9c8d-7e6f5a4b3c2d",
  timestamp: "1795000000000",
};
const foldersCanonical = ["SHOTFOLDER-V1", "GET", "/v1/folders", folders.deviceId, folders.requestId, folders.timestamp].join("\n");

const sig = (s) => sign("sha256", Buffer.from(s, "utf8"), { key: privateKey, dsaEncoding: "der" }).toString("base64");

const vetores = {
  aviso: "Chave SOMENTE DE TESTE, gerada por test/gerar-vetores.mjs. Nunca usar fora dos testes.",
  algoritmo: "ECDSA P-256 + SHA-256, assinatura DER, chave pública SPKI/DER em base64",
  publicKeySpki: spki,
  privateKeyPkcs8: pkcs8,
  bodyUtf8: body.toString("utf8"),
  upload: { fields: upload, canonical: uploadCanonical, signature: sig(uploadCanonical) },
  folders: { fields: folders, canonical: foldersCanonical, signature: sig(foldersCanonical) },
};
writeFileSync(new URL("./vetores.json", import.meta.url), JSON.stringify(vetores, null, 2) + "\n");
console.log("vetores.json gerado");
