/**
 * Regras sobre pastas e arquivos no disco do PC.
 */
import { randomBytes } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import { join, parse, resolve, sep } from "node:path";
import type { AllowedContentType } from "@shotfolder/protocol";

/** Pastas do sistema onde nunca se grava, mesmo que alguém coloque na lista. */
export function defaultForbiddenRoots(stateDir: string): string[] {
  const env = process.env;
  return [
    env.SystemRoot ?? "C:\\Windows",
    env.ProgramFiles ?? "C:\\Program Files",
    env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)",
    env.ProgramData ?? "C:\\ProgramData",
    env.APPDATA, // inclui a pasta Inicializar (Startup)
    env.LOCALAPPDATA,
    stateDir,
  ]
    .filter((p): p is string => typeof p === "string" && p.length > 0)
    .map((p) => resolve(p).toLowerCase());
}

function isInside(child: string, parent: string): boolean {
  return child === parent || child.startsWith(parent.endsWith(sep) ? parent : parent + sep);
}

/**
 * Confere se uma pasta da lista pode receber arquivos. Devolve o motivo da recusa,
 * ou `null` se está tudo certo. Chamada na partida e de novo antes de cada gravação.
 */
export async function checkFolderPath(path: string, forbidden: string[]): Promise<string | null> {
  if (path.startsWith("\\\\")) return "caminho de rede (UNC) não é permitido";
  const full = resolve(path);
  if (parse(full).root.toLowerCase() === full.toLowerCase()) return "raiz de disco não é permitida";
  const lower = full.toLowerCase();
  if (forbidden.map((r) => resolve(r).toLowerCase()).some((root) => isInside(lower, root))) return "pasta do sistema ou do programa";

  let info;
  try {
    info = await lstat(full);
  } catch {
    return "pasta não existe";
  }
  if (info.isSymbolicLink()) return "a pasta é um link ou junção";
  if (!info.isDirectory()) return "não é uma pasta";

  // Se algum nível acima for link/junção, o caminho real muda: recusa.
  const real = await realpath(full);
  if (real.toLowerCase() !== lower) return `o caminho real é outro (${real}); há link ou junção no meio`;
  return null;
}

export const EXTENSIONS: Record<AllowedContentType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** Tipo real do arquivo pelos primeiros bytes (não confia no que o celular diz). */
export function sniffImageType(head: Buffer): AllowedContentType | null {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  if (head.length >= 8 && head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (head.length >= 12 && head.toString("latin1", 0, 4) === "RIFF" && head.toString("latin1", 8, 12) === "WEBP") {
    return "image/webp";
  }
  return null;
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/**
 * Nome gerado pelo PC: 2026-11-23_153012_a1b2.jpg (horário local).
 * Só dígitos, hífen, sublinhado e letras minúsculas: sem nome reservado,
 * sem ":" (fluxo alternativo do NTFS), sem ponto ou espaço no fim.
 */
export function generateFileName(nowMs: number, type: AllowedContentType): string {
  const d = new Date(nowMs);
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `${date}_${time}_${randomBytes(2).toString("hex")}.${EXTENSIONS[type]}`;
}

export function destinationPath(folderPath: string, fileName: string): string {
  return join(resolve(folderPath), fileName);
}
