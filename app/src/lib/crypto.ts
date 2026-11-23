/**
 * Criptografia do app, sem nada nativo (roda igual no celular e nos testes do Node).
 *
 * MVP (etapas 4–5): chave P-256 gerada em software com @noble/curves e guardada no
 * SecureStore. Na etapa 6 ela é trocada por uma chave do Android Keystore, que nunca
 * sai do hardware — por isso tudo passa pela interface `Signer`.
 */
import { p256 } from "@noble/curves/nist.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { pairCodeFromSha256Hex, pairCodeInput } from "@shotfolder/protocol";

export interface Signer {
  /** Chave pública em SPKI/DER, base64 (formato que o PC guarda). */
  readonly publicKeySpki: string;
  /** Assina o texto (SHA-256 + ECDSA P-256) e devolve a assinatura DER em base64. */
  sign(text: string): Promise<string>;
}

// ---------- codificação ----------

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function bytesToBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]!;
    out += b === undefined ? "=" : B64[(n >> 6) & 63]!;
    out += c === undefined ? "=" : B64[n & 63]!;
  }
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function hexToBytes(hex: string): Uint8Array {
  if (!/^(?:[0-9a-f]{2})+$/.test(hex)) throw new Error("Hex inválido.");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

export function sha256Hex(data: string | Uint8Array): string {
  return bytesToHex(sha256(typeof data === "string" ? utf8(data) : data));
}

// ---------- chave pública no formato SPKI ----------

/**
 * Cabeçalho DER fixo de uma chave pública EC P-256 em SPKI:
 * SEQUENCE { SEQUENCE { id-ecPublicKey, prime256v1 }, BIT STRING { 04 || X || Y } }.
 */
const SPKI_P256_PREFIX = hexToBytes("3059301306072a8648ce3d020106082a8648ce3d030107034200");

export function spkiFromRawPublicKey(raw: Uint8Array): string {
  if (raw.length !== 65 || raw[0] !== 0x04) throw new Error("Chave pública P-256 não comprimida esperada.");
  const der = new Uint8Array(SPKI_P256_PREFIX.length + raw.length);
  der.set(SPKI_P256_PREFIX, 0);
  der.set(raw, SPKI_P256_PREFIX.length);
  return bytesToBase64(der);
}

// ---------- chave em software (MVP) ----------

export class SoftwareSigner implements Signer {
  readonly publicKeySpki: string;

  private constructor(private readonly secretKey: Uint8Array) {
    this.publicKeySpki = spkiFromRawPublicKey(p256.getPublicKey(secretKey, false));
  }

  /** `randomBytes` vem do expo-crypto no celular e do node:crypto nos testes. */
  static generate(randomBytes: (n: number) => Uint8Array): SoftwareSigner {
    return new SoftwareSigner(p256.utils.randomSecretKey(randomBytes(48)));
  }

  static fromSecretHex(hex: string): SoftwareSigner {
    return new SoftwareSigner(hexToBytes(hex));
  }

  /** Só para guardar no SecureStore. */
  secretHex(): string {
    return bytesToHex(this.secretKey);
  }

  async sign(text: string): Promise<string> {
    // prehash: true → assina SHA-256(texto), igual ao "SHA256withECDSA" do Android/Node.
    return bytesToBase64(p256.sign(utf8(text), this.secretKey, { prehash: true, format: "der" }));
  }
}

/** Código de 6 dígitos que o celular mostra no pareamento (o PC calcula o mesmo). */
export function pairCodeFor(token: string, publicKeySpki: string): string {
  return pairCodeFromSha256Hex(sha256Hex(pairCodeInput(token, publicKeySpki)));
}
