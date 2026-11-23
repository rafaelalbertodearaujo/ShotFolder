/**
 * Estado do servidor em disco: configuração, aparelhos, envios já recebidos e log.
 * Tudo fica numa pasta só (padrão: %LOCALAPPDATA%\ShotFolder), fora do repositório.
 * Os arquivos são relidos a cada requisição: são pequenos, e assim uma revogação
 * ou mudança de pasta vale na hora, sem reiniciar.
 */
import { randomBytes } from "node:crypto";
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import type { KeyObject } from "node:crypto";
import { PATTERNS } from "@shotfolder/protocol";
import { importDevicePublicKey } from "@shotfolder/protocol/node";

export function defaultStateDir(): string {
  if (process.env.SHOTFOLDER_HOME) return process.env.SHOTFOLDER_HOME;
  const local = process.env.LOCALAPPDATA;
  if (!local) throw new Error("Variável LOCALAPPDATA não definida.");
  return join(local, "ShotFolder");
}

export const FILES = {
  config: "config.json",
  devices: "devices.json",
  seen: "uploads-vistos.json",
  audit: "audit.jsonl",
  tmp: "tmp",
} as const;

// ---------- leitura e escrita segura de JSON ----------

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw new Error(`Não consegui ler ${file}: ${(e as Error).message}`);
  }
}

/** Grava num arquivo temporário e renomeia: nunca deixa o JSON pela metade. */
async function writeJson(file: string, data: unknown): Promise<void> {
  const tmp = `${file}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
  await rename(tmp, file);
}

export async function ensureStateDir(dir: string): Promise<void> {
  await mkdir(join(dir, FILES.tmp), { recursive: true });
}

// ---------- configuração ----------

export interface FolderEntry {
  /** Código que o celular envia (nunca um caminho). */
  id: string;
  /** Nome mostrado no celular. */
  name: string;
  /** Caminho absoluto no PC. Nunca sai do PC. */
  path: string;
}

export interface Limits {
  maxUploadsPerMinute: number;
  maxBytesPerDay: number;
  minFreeBytes: number;
}

export interface Config {
  port: number;
  /** IP do Tailscale do PC. Se ausente, é descoberto com `tailscale ip -4`. */
  host?: string;
  folders: FolderEntry[];
  defaultFolder?: string;
  limits: Limits;
}

export const DEFAULT_LIMITS: Limits = {
  maxUploadsPerMinute: 30,
  maxBytesPerDay: 2 * 1024 ** 3,
  minFreeBytes: 5 * 1024 ** 3,
};

export const DEFAULT_PORT = 47800;

/** Lê e valida config.json. Configuração inválida é erro, não "valor padrão". */
export async function loadConfig(dir: string): Promise<Config> {
  const raw = await readJson<Partial<Config>>(join(dir, FILES.config), {});
  const port = raw.port ?? DEFAULT_PORT;
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("config.json: porta inválida.");
  if (raw.host !== undefined && typeof raw.host !== "string") throw new Error("config.json: host inválido.");

  const folders = raw.folders ?? [];
  if (!Array.isArray(folders)) throw new Error("config.json: folders precisa ser uma lista.");
  const ids = new Set<string>();
  for (const f of folders) {
    if (typeof f?.id !== "string" || !PATTERNS.folderId.test(f.id)) {
      throw new Error(`config.json: código de pasta inválido: ${JSON.stringify(f?.id)} (use minúsculas, dígitos e hífen).`);
    }
    if (ids.has(f.id)) throw new Error(`config.json: código de pasta repetido: ${f.id}`);
    ids.add(f.id);
    if (typeof f.name !== "string" || f.name.length < 1 || f.name.length > 60 || /[\r\n]/.test(f.name)) {
      throw new Error(`config.json: nome inválido na pasta ${f.id}.`);
    }
    if (typeof f.path !== "string" || !isAbsolute(f.path)) {
      throw new Error(`config.json: caminho precisa ser absoluto na pasta ${f.id}.`);
    }
  }
  if (raw.defaultFolder !== undefined && !ids.has(raw.defaultFolder)) {
    throw new Error("config.json: defaultFolder não está na lista de pastas.");
  }
  const limits = { ...DEFAULT_LIMITS, ...(raw.limits ?? {}) };
  for (const [k, v] of Object.entries(limits)) {
    if (!Number.isFinite(v) || v < 0) throw new Error(`config.json: limite inválido: ${k}`);
  }
  const cfg: Config = { port, folders, limits };
  if (raw.host !== undefined) cfg.host = raw.host;
  if (raw.defaultFolder !== undefined) cfg.defaultFolder = raw.defaultFolder;
  return cfg;
}

// ---------- aparelhos ----------

export interface Device {
  id: string;
  name: string;
  /** Chave pública EC P-256 em SPKI/DER, base64. */
  publicKey: string;
  createdAt: string;
  revokedAt?: string;
}

export async function loadDevices(dir: string): Promise<Device[]> {
  const data = await readJson<{ devices?: Device[] }>(join(dir, FILES.devices), {});
  return Array.isArray(data.devices) ? data.devices : [];
}

export async function saveDevices(dir: string, devices: Device[]): Promise<void> {
  await writeJson(join(dir, FILES.devices), { devices });
}

export function newDeviceId(): string {
  return `dev_${randomBytes(12).toString("base64url")}`;
}

/** Função de busca de chave: aparelho revogado ou com chave inválida = desconhecido. */
export function keyLookup(devices: Device[]): (id: string) => KeyObject | undefined {
  return (id) => {
    const d = devices.find((x) => x.id === id);
    if (!d || d.revokedAt) return undefined;
    try {
      return importDevicePublicKey(d.publicKey);
    } catch {
      return undefined;
    }
  };
}

// ---------- envios já recebidos (contra repetição e para reenvio idempotente) ----------

export interface SeenEntry {
  deviceId: string;
  folderId: string;
  file: string;
  at: string;
}

/** Quanto tempo lembrar de um uploadId (a fila do celular pode reenviar dias depois). */
export const SEEN_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export class SeenStore {
  private constructor(
    private readonly file: string,
    private readonly entries: Record<string, SeenEntry>,
  ) {}

  static async open(dir: string): Promise<SeenStore> {
    const file = join(dir, FILES.seen);
    return new SeenStore(file, await readJson<Record<string, SeenEntry>>(file, {}));
  }

  get(uploadId: string): SeenEntry | undefined {
    return Object.hasOwn(this.entries, uploadId) ? this.entries[uploadId] : undefined;
  }

  async add(uploadId: string, entry: SeenEntry, nowMs: number): Promise<void> {
    this.entries[uploadId] = entry;
    for (const [id, e] of Object.entries(this.entries)) {
      if (nowMs - Date.parse(e.at) > SEEN_RETENTION_MS) delete this.entries[id];
    }
    await writeJson(this.file, this.entries);
  }
}

// ---------- log de auditoria ----------

export type AuditEvent = Record<string, string | number | boolean | undefined> & { event: string };

export async function audit(dir: string, nowMs: number, ev: AuditEvent): Promise<void> {
  const line = JSON.stringify({ at: new Date(nowMs).toISOString(), ...ev });
  await appendFile(join(dir, FILES.audit), line + "\n", "utf8");
}
