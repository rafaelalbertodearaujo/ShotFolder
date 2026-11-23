/**
 * `shotfolder daemon`: vigia que mantém o servidor de pé, sem janela.
 *
 * - Roda `shotfolder serve` como processo filho e grava a saída em server.log.
 * - Se o servidor cair (ou o Tailscale ainda não subiu depois do boot), espera e tenta
 *   de novo: 5 s, 10 s, 30 s e depois a cada 60 s.
 * - Se o servidor sair "de propósito" (shotfolder stop) ou a porta já estiver em uso
 *   (outra cópia rodando), o vigia também termina.
 * - Só uma cópia do vigia por vez (arquivo daemon.pid).
 */
import { spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { appendFile, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultStateDir, ensureStateDir } from "./state.js";

/** Códigos de saída do `serve` que o vigia entende. */
export const EXIT = {
  /** Parado de propósito (shotfolder stop / Ctrl+C). */
  stopped: 0,
  /** Porta já em uso: outra cópia está rodando. */
  inUse: 3,
} as const;

export const DAEMON_FILES = { pid: "daemon.pid", log: "server.log" } as const;
const MAX_LOG_BYTES = 5 * 1024 * 1024;
const BACKOFF_MS = [5_000, 10_000, 30_000, 60_000];

/** Espera antes da tentativa número `n` (0 = primeira falha). */
export function nextDelay(n: number): number {
  return BACKOFF_MS[Math.min(n, BACKOFF_MS.length - 1)]!;
}

export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0); // sinal 0: só pergunta se o processo existe
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

export async function readDaemonPid(dir: string): Promise<number | null> {
  try {
    const pid = Number((await readFile(join(dir, DAEMON_FILES.pid), "utf8")).trim());
    return isProcessAlive(pid) ? pid : null;
  } catch {
    return null;
  }
}

async function rotateLog(path: string): Promise<void> {
  try {
    if ((await stat(path)).size > MAX_LOG_BYTES) await rename(path, `${path}.1`);
  } catch {
    // log ainda não existe
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function daemon(serveFlags: string[]): Promise<void> {
  const dir = defaultStateDir();
  await ensureStateDir(dir);
  const pidFile = join(dir, DAEMON_FILES.pid);
  const logFile = join(dir, DAEMON_FILES.log);

  const outro = await readDaemonPid(dir);
  if (outro && outro !== process.pid) {
    console.log(`O ShotFolder já está rodando (vigia pid ${outro}).`);
    return;
  }
  await writeFile(pidFile, String(process.pid), "utf8");

  const note = (msg: string) => appendFile(logFile, `[${new Date().toISOString()}] [vigia] ${msg}\n`).catch(() => {});
  const cli = fileURLToPath(new URL("./cli.js", import.meta.url));
  let child: ReturnType<typeof spawn> | null = null;
  let encerrando = false;

  const encerrar = async () => {
    encerrando = true;
    child?.kill();
    await unlink(pidFile).catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", () => void encerrar());
  process.on("SIGTERM", () => void encerrar());

  await note(`iniciado (pid ${process.pid})`);
  let falhas = 0;
  while (!encerrando) {
    await rotateLog(logFile);
    const fd = openSync(logFile, "a");
    const inicio = Date.now();
    child = spawn(process.execPath, [cli, "serve", ...serveFlags], {
      stdio: ["ignore", fd, fd],
      windowsHide: true,
    });
    const code = await new Promise<number | null>((resolve) => {
      child!.once("exit", (c) => resolve(c));
      child!.once("error", () => resolve(1));
    });
    closeSync(fd);
    child = null;

    if (code === EXIT.stopped) {
      await note("servidor parado de propósito; vigia encerrando");
      break;
    }
    if (code === EXIT.inUse) {
      await note("porta em uso (outra cópia rodando?); vigia encerrando");
      break;
    }
    // Rodou bem por 5 min? Então a próxima falha recomeça a espera curta.
    if (Date.now() - inicio > 5 * 60_000) falhas = 0;
    const espera = nextDelay(falhas++);
    await note(`servidor saiu com código ${code}; nova tentativa em ${espera / 1000} s`);
    await sleep(espera);
  }
  await unlink(pidFile).catch(() => {});
}
