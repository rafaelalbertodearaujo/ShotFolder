import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Faixa de IPs que o Tailscale usa (100.64.0.0/10, ou seja, 100.64.x.x a 100.127.x.x). */
export function isTailscaleIPv4(ip: string): boolean {
  const m = /^100\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return false;
  const [a, b, c] = m.slice(1).map(Number) as [number, number, number];
  return a >= 64 && a <= 127 && b <= 255 && c <= 255;
}

/** Caminho do tailscale.exe (ou só "tailscale", se estiver no PATH). */
export function tailscaleExe(): string {
  const padrao = "C:\\Program Files\\Tailscale\\tailscale.exe";
  return existsSync(padrao) ? padrao : "tailscale";
}

/** Roda o tailscale.exe e devolve a saída, ou null se não estiver instalado/rodando. */
export async function runTailscale(args: string[]): Promise<string | null> {
  try {
    const { stdout, stderr } = await run(tailscaleExe(), args, { windowsHide: true, timeout: 10_000 });
    return `${stdout}${stderr}`;
  } catch (e) {
    const out = e as { stdout?: string; stderr?: string; code?: unknown };
    // Alguns comandos saem com código ≠ 0 mas têm saída útil.
    return typeof out.stdout === "string" && out.stdout.length > 0 ? `${out.stdout}${out.stderr ?? ""}` : null;
  }
}

export async function detectTailscaleIp(): Promise<string | null> {
  const out = await runTailscale(["ip", "-4"]);
  const ip = out?.trim().split(/\s+/)[0];
  return ip && isTailscaleIPv4(ip) ? ip : null;
}
