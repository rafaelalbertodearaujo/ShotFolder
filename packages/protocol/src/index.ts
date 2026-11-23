/**
 * Protocolo v1 do ShotFolder — parte comum ao celular e ao PC.
 *
 * Este arquivo não usa nada do Node, para rodar também no app (React Native).
 * A verificação de assinatura, que depende de `node:crypto`, fica em `./node`.
 *
 * Ideia central: o celular assina uma "string canônica" (sempre montada do mesmo
 * jeito) com os dados da requisição. O PC remonta a mesma string a partir dos
 * cabeçalhos e confere a assinatura. Qualquer campo alterado no caminho quebra
 * a assinatura.
 */

export const PROTOCOL_VERSION = "SHOTFOLDER-V1";

export const ROUTES = {
  upload: "/v1/upload",
  folders: "/v1/folders",
  pair: "/v1/pair",
} as const;

/** Nomes dos cabeçalhos, em minúsculas (o Node entrega cabeçalhos assim). */
export const HEADERS = {
  device: "x-sf-device",
  upload: "x-sf-upload",
  request: "x-sf-request",
  time: "x-sf-time",
  folder: "x-sf-folder",
  sha256: "x-sf-sha256",
  signature: "x-sf-signature",
  contentType: "content-type",
  contentLength: "content-length",
} as const;

export const LIMITS = {
  /** Tamanho máximo de uma foto (25 MB). */
  maxUploadBytes: 25 * 1024 * 1024,
  /** Diferença máxima aceita entre o relógio do celular e o do PC (5 min). */
  clockSkewMs: 5 * 60 * 1000,
} as const;

/** Tipos aceitos. HEIC fica de fora: o app converte para JPEG antes de enviar. */
export const ALLOWED_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type AllowedContentType = (typeof ALLOWED_CONTENT_TYPES)[number];

/**
 * Formato de cada campo. Todos são restritos o bastante para nunca conter
 * quebra de linha, que é o separador da string canônica.
 */
export const PATTERNS = {
  /** Identificador do aparelho, gerado pelo PC no pareamento (base64url). */
  deviceId: /^[A-Za-z0-9_-]{8,64}$/,
  /** UUID v4 em minúsculas (expo-crypto e crypto.randomUUID geram assim). */
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  /** Horário em milissegundos desde 1970, com 13 dígitos. */
  timestamp: /^[1-9][0-9]{12}$/,
  /** Código da pasta: minúsculas, dígitos e hífen. Nunca é um caminho. */
  folderId: /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/,
  /** Tamanho em bytes, sem zero à esquerda. */
  contentLength: /^[1-9][0-9]{0,9}$/,
  /** SHA-256 em hexadecimal minúsculo. */
  sha256: /^[0-9a-f]{64}$/,
  /** Assinatura ECDSA P-256 em DER, codificada em base64 (até ~96 caracteres). */
  signature: /^[A-Za-z0-9+/]{8,200}={0,2}$/,
} as const;

export type ErrorCode =
  | "missing_header"
  | "duplicate_header"
  | "invalid_field"
  | "clock_skew"
  | "unknown_device"
  | "bad_signature";

export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: ErrorCode; field?: string };

export interface UploadFields {
  deviceId: string;
  uploadId: string;
  timestamp: string;
  folderId: string;
  contentType: AllowedContentType;
  contentLength: string;
  sha256: string;
}

export interface FoldersFields {
  deviceId: string;
  requestId: string;
  timestamp: string;
}

export type HeaderBag = Record<string, string | string[] | undefined>;

function fail<T>(error: ErrorCode, field?: string): Result<T> {
  return field === undefined ? { ok: false, error } : { ok: false, error, field };
}

/** Lê um cabeçalho único. Cabeçalho repetido é recusado, não "escolhido". */
function readHeader(headers: HeaderBag, name: string): Result<string> {
  const raw = headers[name];
  if (raw === undefined) return fail("missing_header", name);
  if (Array.isArray(raw)) return fail("duplicate_header", name);
  return { ok: true, value: raw };
}

function readMatching(headers: HeaderBag, name: string, pattern: RegExp): Result<string> {
  const r = readHeader(headers, name);
  if (!r.ok) return r;
  if (!pattern.test(r.value)) return fail("invalid_field", name);
  return r;
}

function isAllowedContentType(v: string): v is AllowedContentType {
  return (ALLOWED_CONTENT_TYPES as readonly string[]).includes(v);
}

/** Confere o formato de todos os campos de um envio. */
export function validateUploadFields(f: UploadFields): Result<UploadFields> {
  if (!PATTERNS.deviceId.test(f.deviceId)) return fail("invalid_field", HEADERS.device);
  if (!PATTERNS.uuid.test(f.uploadId)) return fail("invalid_field", HEADERS.upload);
  if (!PATTERNS.timestamp.test(f.timestamp)) return fail("invalid_field", HEADERS.time);
  if (!PATTERNS.folderId.test(f.folderId)) return fail("invalid_field", HEADERS.folder);
  if (!isAllowedContentType(f.contentType)) return fail("invalid_field", HEADERS.contentType);
  if (!PATTERNS.contentLength.test(f.contentLength) || Number(f.contentLength) > LIMITS.maxUploadBytes) {
    return fail("invalid_field", HEADERS.contentLength);
  }
  if (!PATTERNS.sha256.test(f.sha256)) return fail("invalid_field", HEADERS.sha256);
  return { ok: true, value: f };
}

export function validateFoldersFields(f: FoldersFields): Result<FoldersFields> {
  if (!PATTERNS.deviceId.test(f.deviceId)) return fail("invalid_field", HEADERS.device);
  if (!PATTERNS.uuid.test(f.requestId)) return fail("invalid_field", HEADERS.request);
  if (!PATTERNS.timestamp.test(f.timestamp)) return fail("invalid_field", HEADERS.time);
  return { ok: true, value: f };
}

/**
 * String assinada de um envio. Valida antes de montar: um campo com quebra de
 * linha poderia "empurrar" os outros e gerar a mesma string com outro sentido.
 */
export function buildUploadCanonical(f: UploadFields): string {
  const v = validateUploadFields(f);
  if (!v.ok) throw new Error(`Campo inválido na string canônica: ${v.field}`);
  return [
    PROTOCOL_VERSION,
    "POST",
    ROUTES.upload,
    f.deviceId,
    f.uploadId,
    f.timestamp,
    f.folderId,
    f.contentType,
    f.contentLength,
    f.sha256,
  ].join("\n");
}

export function buildFoldersCanonical(f: FoldersFields): string {
  const v = validateFoldersFields(f);
  if (!v.ok) throw new Error(`Campo inválido na string canônica: ${v.field}`);
  return [PROTOCOL_VERSION, "GET", ROUTES.folders, f.deviceId, f.requestId, f.timestamp].join("\n");
}

/** O horário assinado está dentro da janela aceita em relação a `nowMs`? */
export function isTimestampFresh(timestamp: string, nowMs: number, skewMs: number = LIMITS.clockSkewMs): boolean {
  if (!PATTERNS.timestamp.test(timestamp)) return false;
  return Math.abs(Number(timestamp) - nowMs) <= skewMs;
}

/** Monta os cabeçalhos que o celular envia junto com a foto. */
export function uploadHeaders(f: UploadFields, signatureBase64: string): Record<string, string> {
  return {
    [HEADERS.device]: f.deviceId,
    [HEADERS.upload]: f.uploadId,
    [HEADERS.time]: f.timestamp,
    [HEADERS.folder]: f.folderId,
    [HEADERS.contentType]: f.contentType,
    [HEADERS.contentLength]: f.contentLength,
    [HEADERS.sha256]: f.sha256,
    [HEADERS.signature]: signatureBase64,
  };
}

export function foldersHeaders(f: FoldersFields, signatureBase64: string): Record<string, string> {
  return {
    [HEADERS.device]: f.deviceId,
    [HEADERS.request]: f.requestId,
    [HEADERS.time]: f.timestamp,
    [HEADERS.signature]: signatureBase64,
  };
}

export interface Signed<T> {
  fields: T;
  signature: string;
}

/** Lê e valida os cabeçalhos de um envio (ainda sem conferir a assinatura). */
export function parseUploadHeaders(headers: HeaderBag): Result<Signed<UploadFields>> {
  const deviceId = readMatching(headers, HEADERS.device, PATTERNS.deviceId);
  if (!deviceId.ok) return deviceId;
  const uploadId = readMatching(headers, HEADERS.upload, PATTERNS.uuid);
  if (!uploadId.ok) return uploadId;
  const timestamp = readMatching(headers, HEADERS.time, PATTERNS.timestamp);
  if (!timestamp.ok) return timestamp;
  const folderId = readMatching(headers, HEADERS.folder, PATTERNS.folderId);
  if (!folderId.ok) return folderId;
  const contentType = readHeader(headers, HEADERS.contentType);
  if (!contentType.ok) return contentType;
  // Comparação exata: "image/jpeg; charset=x" e variações são recusadas.
  if (!isAllowedContentType(contentType.value)) return fail("invalid_field", HEADERS.contentType);
  const contentLength = readMatching(headers, HEADERS.contentLength, PATTERNS.contentLength);
  if (!contentLength.ok) return contentLength;
  const sha256 = readMatching(headers, HEADERS.sha256, PATTERNS.sha256);
  if (!sha256.ok) return sha256;
  const signature = readMatching(headers, HEADERS.signature, PATTERNS.signature);
  if (!signature.ok) return signature;

  const fields: UploadFields = {
    deviceId: deviceId.value,
    uploadId: uploadId.value,
    timestamp: timestamp.value,
    folderId: folderId.value,
    contentType: contentType.value,
    contentLength: contentLength.value,
    sha256: sha256.value,
  };
  const v = validateUploadFields(fields);
  if (!v.ok) return v;
  return { ok: true, value: { fields, signature: signature.value } };
}

export function parseFoldersHeaders(headers: HeaderBag): Result<Signed<FoldersFields>> {
  const deviceId = readMatching(headers, HEADERS.device, PATTERNS.deviceId);
  if (!deviceId.ok) return deviceId;
  const requestId = readMatching(headers, HEADERS.request, PATTERNS.uuid);
  if (!requestId.ok) return requestId;
  const timestamp = readMatching(headers, HEADERS.time, PATTERNS.timestamp);
  if (!timestamp.ok) return timestamp;
  const signature = readMatching(headers, HEADERS.signature, PATTERNS.signature);
  if (!signature.ok) return signature;
  return {
    ok: true,
    value: {
      fields: { deviceId: deviceId.value, requestId: requestId.value, timestamp: timestamp.value },
      signature: signature.value,
    },
  };
}
