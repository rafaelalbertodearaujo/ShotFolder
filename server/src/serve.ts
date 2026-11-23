/**
 * Inicia o servidor (comando `shotfolder serve`).
 *   serve           escuta só no IP do Tailscale (uso normal)
 *   serve --local   escuta só em 127.0.0.1 (teste no próprio PC)
 * Também sobe a API admin em 127.0.0.1:<adminPort> e grava um token novo em admin.token.
 */
import { randomBytes } from "node:crypto";
import { unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildAdminApp } from "./admin.js";
import { buildApp, createPairing } from "./app.js";
import { EXIT } from "./daemon.js";
import { checkFolderPath, defaultForbiddenRoots } from "./files.js";
import { detectTailscaleIp, isTailscaleIPv4 } from "./net.js";
import { windowsToast } from "./notify.js";
import { defaultStateDir, ensureStateDir, FILES, loadConfig, SeenStore } from "./state.js";

export async function serve(local: boolean): Promise<void> {
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

  const pairing = createPairing(dir);
  const seen = await SeenStore.open(dir);
  const app = await buildApp({ stateDir: dir, notify: windowsToast, pairing, seen });
  try {
    await app.listen({ host, port: cfg.port });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EADDRINUSE") {
      console.error(`Porta ${cfg.port} já em uso: o ShotFolder já está rodando?`);
      process.exit(EXIT.inUse);
    }
    throw e;
  }

  // Token novo a cada partida; a CLI lê este arquivo para falar com a API admin.
  const token = randomBytes(32).toString("base64url");
  await writeFile(join(dir, FILES.adminToken), token, { encoding: "utf8", mode: 0o600 });
  const admin = await buildAdminApp({
    stateDir: dir,
    token,
    adminPort: cfg.adminPort,
    publicHost: host,
    publicPort: cfg.port,
    pairing,
    onShutdown: () => stop(),
    seen,
  });
  try {
    await admin.listen({ host: "127.0.0.1", port: cfg.adminPort });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EADDRINUSE") {
      console.error(`Porta admin ${cfg.adminPort} já em uso: o ShotFolder já está rodando?`);
      process.exit(EXIT.inUse);
    }
    throw e;
  }

  console.log(`ShotFolder ouvindo em http://${host}:${cfg.port} (estado em ${dir})`);
  console.log(`Admin local em http://127.0.0.1:${cfg.adminPort}. Para parear: shotfolder pair`);

  function stop() {
    pairing.cancel();
    void Promise.all([app.close(), admin.close(), unlink(join(dir, FILES.adminToken)).catch(() => {})]).then(() =>
      process.exit(EXIT.stopped),
    );
  }
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

