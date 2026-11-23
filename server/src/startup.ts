/**
 * Inicialização com o Windows, sem administrador:
 * um atalho "ShotFolder" na pasta Inicializar do seu usuário.
 *
 * Por que atalho na pasta Inicializar (e não Serviço do Windows ou Agendador):
 *   - aparece no Gerenciador de Tarefas → Aplicativos de inicialização, com
 *     Habilitar/Desabilitar;
 *   - roda na sua sessão, então a notificação do Windows funciona;
 *   - não precisa de administrador.
 *
 * O atalho chama `conhost.exe --headless node cli.js daemon`: o Node roda sem janela.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SHORTCUT_NAME = "ShotFolder.lnk";

export function startupDir(): string {
  // Os testes trocam a pasta para não mexer na Inicializar de verdade.
  if (process.env.SHOTFOLDER_STARTUP_DIR) return process.env.SHOTFOLDER_STARTUP_DIR;
  const appdata = process.env.APPDATA;
  if (!appdata) throw new Error("Variável APPDATA não definida.");
  return join(appdata, "Microsoft", "Windows", "Start Menu", "Programs", "Startup");
}

export const shortcutPath = () => join(startupDir(), SHORTCUT_NAME);

export interface LaunchCommand {
  target: string;
  args: string[];
  workingDir: string;
}

/** Comando que o atalho executa. */
export function launchCommand(daemonFlags: string[]): LaunchCommand {
  const cli = fileURLToPath(new URL("./cli.js", import.meta.url));
  const conhost = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "conhost.exe");
  return {
    target: conhost,
    args: ["--headless", process.execPath, cli, "daemon", ...daemonFlags],
    // raiz do projeto (server/dist/.. /..)
    workingDir: resolve(dirname(cli), "..", ".."),
  };
}

/** Junta argumentos com aspas, do jeito que o Windows espera numa linha de comando. */
export function quoteArgs(args: string[]): string {
  return args.map((a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)).join(" ");
}

/** Cria (ou recria) o atalho. Os valores vão por variável de ambiente: nada é interpretado pelo PowerShell. */
export function createShortcut(cmd: LaunchCommand): void {
  const script = [
    "$s = (New-Object -ComObject WScript.Shell).CreateShortcut($env:SF_LNK)",
    "$s.TargetPath = $env:SF_TARGET",
    "$s.Arguments = $env:SF_ARGS",
    "$s.WorkingDirectory = $env:SF_WORKDIR",
    "$s.Description = 'ShotFolder: recebe fotos do celular'",
    "$s.IconLocation = $env:SF_ICON",
    "$s.WindowStyle = 7",
    "$s.Save()",
  ].join("; ");
  const r = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    windowsHide: true,
    encoding: "utf8",
    env: {
      ...process.env,
      SF_LNK: shortcutPath(),
      SF_TARGET: cmd.target,
      SF_ARGS: quoteArgs(cmd.args),
      SF_WORKDIR: cmd.workingDir,
      SF_ICON: `${process.execPath},0`,
    },
  });
  if (r.status !== 0 || !existsSync(shortcutPath())) {
    throw new Error(`Não consegui criar o atalho: ${r.stderr || r.stdout}`);
  }
}

export async function removeShortcut(): Promise<boolean> {
  try {
    await unlink(shortcutPath());
    return true;
  } catch {
    return false;
  }
}

/**
 * Inicia agora abrindo o próprio atalho, exatamente como o Windows faz no logon.
 * (Iniciar o conhost direto pelo Node, como processo "desligado", não funciona.)
 */
export function startViaShortcut(): void {
  const r = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", "Start-Process -FilePath $env:SF_LNK"],
    { windowsHide: true, encoding: "utf8", env: { ...process.env, SF_LNK: shortcutPath() } },
  );
  if (r.status !== 0) throw new Error(`Não consegui iniciar pelo atalho: ${r.stderr || r.stdout}`);
}
