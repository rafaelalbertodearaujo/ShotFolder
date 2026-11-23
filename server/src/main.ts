#!/usr/bin/env node
/**
 * Inicia o servidor.
 *   node dist/main.js           escuta só no IP do Tailscale (uso normal)
 *   node dist/main.js --local   escuta só em 127.0.0.1 (teste no próprio PC)
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import { buildApp } from "./app.js";
import { checkFolderPath, defaultForbiddenRoots } from "./files.js";
import { isTailscaleIPv4 } from "./net.js";
import { windowsToast } from "./notify.js";
import { defaultStateDir, ensureStateDir, loadConfig } from "./state.js";

const run = promisify(execFile);

async function detectTailscaleIp(): Promise<string | null> {
  const candidates = ["C:\\Program Files\\Tailscale\\tailscale.exe", "tailscale"];
  for (const exe of candidates) {
    if (exe.includes("\\") && !existsSync(exe)) continue;
    try {
      const { stdout } = await run(exe, ["ip", "-4"], { windowsHide: true, timeout: 10_000 });
      const ip = stdout.trim().split(/\s+/)[0];
      if (ip) return ip;
    } catch {
      // tenta o próximo
    }
  }
  return null;
}

async function main(): Promise<void> {
  const local = process.argv.includes("--local");
  const dir = defaultStateDir();
  await ensureStateDir(dir);
  const cfg = await loadConfig(dir);

  let host: string;
  if (local) {
    host = "127.0.0.1";
  } else {
    const found = cfg.host ?? (await detectTailscaleIp());
    if (!found) throw new Error("Tailscale não encontrado. Instale e conecte o Tailscale, ou use --local para teste.");
    if (!isTailscaleIPv4(found)) throw new Error(`Recusado: ${found} não é um IP do Tailscale (100.64.0.0/10).`);
    host = found;
  }

  if (cfg.folders.length === 0) console.warn(`Aviso: nenhuma pasta na lista. Edite ${dir}\\config.json.`);
  for (const f of cfg.folders) {
    const problem = await checkFolderPath(f.path, defaultForbiddenRoots(dir));
    console.log(problem ? `  [RECUSADA] ${f.id}: ${problem}` : `  [ok] ${f.id} → ${f.path}`);
  }

  const app = await buildApp({ stateDir: dir, notify: windowsToast });
  await app.listen({ host, port: cfg.port });
  console.log(`ShotFolder ouvindo em http://${host}:${cfg.port} (estado em ${dir})`);

  const stop = () => void app.close().then(() => process.exit(0));
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((e: unknown) => {
  console.error(`Erro: ${(e as Error).message}`);
  process.exit(1);
});
