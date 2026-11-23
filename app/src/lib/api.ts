/**
 * Conversa com o programa do PC. Sem nada nativo: os testes rodam isto contra o
 * servidor de verdade.
 */
import {
  buildFoldersCanonical,
  buildUploadCanonical,
  foldersHeaders,
  LIMITS,
  ROUTES,
  uploadHeaders,
  type PairInfo,
  type UploadFields,
} from "@shotfolder/protocol";
import { sha256Hex, type Signer } from "./crypto";

export interface Session {
  host: string;
  port: number;
  deviceId: string;
}

export interface Folder {
  id: string;
  name: string;
}

export interface FolderList {
  folders: Folder[];
  defaultFolder: string | null;
}

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Mensagens em português para os códigos que o PC devolve. */
const MENSAGENS: Record<string, string> = {
  no_pairing: "O PC não está esperando pareamento. Rode \"shotfolder pair\" de novo.",
  invalid_token: "Este QR não vale mais. Gere outro no PC.",
  already_used: "Este QR já foi usado. Gere outro no PC.",
  expired: "O QR expirou. Gere outro no PC.",
  rejected: "Pareamento recusado no PC.",
  not_confirmed: "Ninguém confirmou no PC a tempo.",
  cancelled: "Pareamento cancelado no PC.",
  invalid_name: "Nome do aparelho inválido.",
  invalid_key: "Chave do aparelho inválida.",
  unauthorized: "O PC não reconhece este celular (revogado ou pareamento apagado). Pareie de novo.",
  network: "Não consegui falar com o PC. O Tailscale está ligado nos dois e o ShotFolder está rodando?",
  unknown_folder: "Essa pasta não está mais na lista do PC. Atualize as pastas.",
  folder_unavailable: "A pasta existe na lista, mas o PC não consegue gravar nela agora.",
  rate_limited: "Muitas fotos em pouco tempo. Espere um minuto.",
  daily_quota: "Cota diária de envio atingida no PC.",
  insufficient_storage: "O disco do PC está quase cheio.",
  hash_mismatch: "A foto chegou corrompida. Tente de novo.",
  size_mismatch: "A foto chegou incompleta. Tente de novo.",
  body_incomplete: "A conexão caiu no meio do envio. Tente de novo.",
  content_mismatch: "O PC não reconheceu o arquivo como JPEG.",
  too_large: "Foto grande demais (limite de 25 MB).",
  upload_id_conflict: "Conflito de identificador de envio. Tente de novo.",
  in_progress: "Essa foto já está sendo enviada.",
};

function erro(code: string, status?: number): ApiError {
  return new ApiError(code, MENSAGENS[code] ?? `Erro do PC: ${code}${status ? ` (${status})` : ""}`);
}

export const baseUrl = (s: { host: string; port: number }) => `http://${s.host}:${s.port}`;

type FetchFn = typeof fetch;

async function request(fetchFn: FetchFn, url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, { ...init, signal: controller.signal });
    let body: Record<string, unknown> = {};
    try {
      body = (await res.json()) as Record<string, unknown>;
    } catch {
      // corpo vazio ou não-JSON
    }
    return { status: res.status, body };
  } catch {
    throw erro("network");
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Pede o pareamento. A resposta só chega depois que você confirma no PC
 * (o PC segura até 90 s), por isso o tempo limite é maior.
 */
export async function pairWithPc(
  info: PairInfo,
  signer: Signer,
  deviceName: string,
  fetchFn: FetchFn = fetch,
): Promise<Session> {
  const { status, body } = await request(
    fetchFn,
    `${baseUrl(info)}${ROUTES.pair}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: info.token, publicKey: signer.publicKeySpki, deviceName }),
    },
    110_000,
  );
  if (status === 201 && typeof body.deviceId === "string") {
    return { host: info.host, port: info.port, deviceId: body.deviceId };
  }
  throw erro(typeof body.error === "string" ? body.error : "unknown", status);
}

export async function listFolders(
  session: Session,
  signer: Signer,
  ids: { now: () => number; uuid: () => string },
  fetchFn: FetchFn = fetch,
): Promise<FolderList> {
  const fields = { deviceId: session.deviceId, requestId: ids.uuid(), timestamp: String(ids.now()) };
  const signature = await signer.sign(buildFoldersCanonical(fields));
  const { status, body } = await request(
    fetchFn,
    `${baseUrl(session)}${ROUTES.folders}`,
    { method: "GET", headers: foldersHeaders(fields, signature) },
    15_000,
  );
  if (status !== 200) throw erro(typeof body.error === "string" ? body.error : "unknown", status);
  const folders = Array.isArray(body.folders)
    ? (body.folders as unknown[]).filter(
        (f): f is Folder =>
          typeof f === "object" && f !== null && typeof (f as Folder).id === "string" && typeof (f as Folder).name === "string",
      )
    : [];
  const defaultFolder = typeof body.defaultFolder === "string" ? body.defaultFolder : null;
  return { folders, defaultFolder };
}

export interface UploadResult {
  /** "saved" = gravada agora; "duplicate" = o PC já tinha recebido este envio. */
  status: "saved" | "duplicate";
  file: string;
  folder: string;
}

/**
 * Envia uma foto JPEG assinada. O `uploadId` identifica a foto: reenviar com o mesmo
 * id (por exemplo, depois de a conexão cair) não grava de novo no PC.
 */
export async function uploadPhoto(
  session: Session,
  signer: Signer,
  folderId: string,
  jpeg: Uint8Array,
  ids: { now: () => number; uuid: () => string },
  opts: { uploadId?: string; fetchFn?: FetchFn } = {},
): Promise<UploadResult> {
  if (jpeg.length === 0) throw erro("size_mismatch");
  if (jpeg.length > LIMITS.maxUploadBytes) throw erro("too_large");
  const fields: UploadFields = {
    deviceId: session.deviceId,
    uploadId: opts.uploadId ?? ids.uuid(),
    timestamp: String(ids.now()),
    folderId,
    contentType: "image/jpeg",
    contentLength: String(jpeg.length),
    sha256: sha256Hex(jpeg),
  };
  const signature = await signer.sign(buildUploadCanonical(fields));
  const { status, body } = await request(
    opts.fetchFn ?? fetch,
    `${baseUrl(session)}${ROUTES.upload}`,
    // Uint8Array: o expo/fetch (Android) e o fetch do Node mandam Content-Length fixo.
    { method: "POST", headers: uploadHeaders(fields, signature), body: jpeg as unknown as BodyInit },
    120_000,
  );
  if ((status === 201 || status === 200) && typeof body.file === "string") {
    return {
      status: status === 201 ? "saved" : "duplicate",
      file: body.file,
      folder: typeof body.folder === "string" ? body.folder : folderId,
    };
  }
  throw erro(typeof body.error === "string" ? body.error : "unknown", status);
}

/** Deixa o nome do modelo dentro do formato aceito pelo PC. */
export function safeDeviceName(raw: string | null | undefined): string {
  const limpo = (raw ?? "")
    .replace(/[^A-Za-z0-9À-ÖØ-öø-ɏ ._()'-]/g, "")
    .trim()
    .slice(0, 40);
  return limpo.length > 0 ? limpo : "Celular";
}
