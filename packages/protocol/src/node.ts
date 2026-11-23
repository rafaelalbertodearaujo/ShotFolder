/**
 * Verificação de assinatura no PC (usa `node:crypto`, por isso fica separada).
 *
 * Algoritmo: ECDSA na curva P-256 com SHA-256, assinatura em formato DER —
 * é o que o Android Keystore produz ("SHA256withECDSA").
 * A chave pública do aparelho é guardada em SPKI/DER, codificada em base64.
 */
import { createPublicKey, verify, type KeyObject } from "node:crypto";
import {
  buildFoldersCanonical,
  buildUploadCanonical,
  isTimestampFresh,
  parseFoldersHeaders,
  parseUploadHeaders,
  type FoldersFields,
  type HeaderBag,
  type Result,
  type Signed,
  type UploadFields,
} from "./index.js";

/** Importa a chave pública de um aparelho. Só aceita EC P-256. */
export function importDevicePublicKey(spkiBase64: string): KeyObject {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(spkiBase64)) {
    throw new Error("Chave pública não está em base64.");
  }
  const key = createPublicKey({ key: Buffer.from(spkiBase64, "base64"), format: "der", type: "spki" });
  if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
    throw new Error("Chave pública precisa ser EC P-256.");
  }
  return key;
}

/** Confere a assinatura. Nunca lança erro: assinatura malformada é só `false`. */
export function verifyCanonical(key: KeyObject, canonical: string, signatureBase64: string): boolean {
  try {
    return verify(
      "sha256",
      Buffer.from(canonical, "utf8"),
      { key, dsaEncoding: "der" },
      Buffer.from(signatureBase64, "base64"),
    );
  } catch {
    return false;
  }
}

export interface AuthOptions {
  /** Horário atual do PC em ms (parâmetro para facilitar os testes). */
  nowMs: number;
  /** Devolve a chave do aparelho, ou `undefined` se não existe ou foi revogado. */
  getPublicKey: (deviceId: string) => KeyObject | undefined;
  skewMs?: number;
}

/**
 * Autentica os cabeçalhos de uma requisição, na ordem mais barata primeiro:
 * formato → horário → aparelho conhecido → assinatura.
 * Repetição (uploadId já visto) e conferência do SHA-256 do corpo ficam no servidor.
 */
function authenticate<T extends { deviceId: string; timestamp: string }>(
  parsed: Result<Signed<T>>,
  canonicalOf: (f: T) => string,
  opts: AuthOptions,
): Result<T> {
  if (!parsed.ok) return parsed;
  const { fields, signature } = parsed.value;
  if (!isTimestampFresh(fields.timestamp, opts.nowMs, opts.skewMs)) {
    return { ok: false, error: "clock_skew" };
  }
  const key = opts.getPublicKey(fields.deviceId);
  if (!key) return { ok: false, error: "unknown_device" };
  if (!verifyCanonical(key, canonicalOf(fields), signature)) {
    return { ok: false, error: "bad_signature" };
  }
  return { ok: true, value: fields };
}

export function authenticateUpload(headers: HeaderBag, opts: AuthOptions): Result<UploadFields> {
  return authenticate(parseUploadHeaders(headers), buildUploadCanonical, opts);
}

export function authenticateFolders(headers: HeaderBag, opts: AuthOptions): Result<FoldersFields> {
  return authenticate(parseFoldersHeaders(headers), buildFoldersCanonical, opts);
}
