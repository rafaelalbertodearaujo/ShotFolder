/**
 * Ações no Windows usadas pelo painel: mandar para a Lixeira e mostrar no Explorer.
 * O caminho vai por variável de ambiente (nada é interpretado pelo PowerShell).
 */
import { spawn, spawnSync } from "node:child_process";

export type Recycler = (path: string) => Promise<void>;
export type Revealer = (path: string) => void;

/** Manda o arquivo para a Lixeira (dá para restaurar). Nunca apaga de vez. */
export const sendToRecycleBin: Recycler = async (path) => {
  const script =
    "Add-Type -AssemblyName Microsoft.VisualBasic; " +
    "[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($env:SF_ALVO, 'OnlyErrorDialogs', 'SendToRecycleBin')";
  const r = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    windowsHide: true,
    encoding: "utf8",
    env: { ...process.env, SF_ALVO: path },
  });
  if (r.status !== 0) throw new Error(`Não consegui mandar para a Lixeira: ${r.stderr || r.stdout}`);
};

/** Abre o Explorer com o arquivo selecionado. */
export const revealInExplorer: Revealer = (path) => {
  if (path.includes('"')) return; // caminho do Windows nunca tem aspas
  const child = spawn("explorer.exe", [`/select,"${path}"`], {
    windowsVerbatimArguments: true,
    detached: true,
    stdio: "ignore",
  });
  child.on("error", () => {});
  child.unref();
};
