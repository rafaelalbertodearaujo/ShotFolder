/**
 * `shotfolder check`: verificação de segurança e saúde, só leitura.
 * Cada item diz OK, AVISO ou PROBLEMA e o que fazer.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readDaemonPid } from "./daemon.js";
import { checkFolderPath, defaultForbiddenRoots } from "./files.js";
import { RULE_PREFIX } from "./firewall.js";
import { detectTailscaleIp, isTailscaleIPv4, runTailscale } from "./net.js";
import { shortcutPath } from "./startup.js";
import { loadConfig, loadDevices } from "./state.js";

export type Nivel = "ok" | "aviso" | "problema";
export interface Item {
  nivel: Nivel;
  texto: string;
  dica?: string;
}

/** Lê regras do firewall (não precisa de administrador para ler). */
function firewallRules(): { nossas: string[]; nodeLiberado: string[] } {
  const script = [
    `$n = @(Get-NetFirewallRule -DisplayName '${RULE_PREFIX}*' -ErrorAction SilentlyContinue | Where-Object Enabled -eq 'True' | ForEach-Object DisplayName)`,
    "$o = @(Get-NetFirewallApplicationFilter -Program '*node.exe' -ErrorAction SilentlyContinue | Get-NetFirewallRule | Where-Object { $_.Direction -eq 'Inbound' -and $_.Action -eq 'Allow' -and $_.Enabled -eq 'True' -and $_.DisplayName -notlike 'ShotFolder*' } | ForEach-Object { $_.DisplayName + ' (' + $_.Profile + ')' })",
    "@{ nossas = $n; node = $o } | ConvertTo-Json -Compress",
  ].join("; ");
  const r = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    windowsHide: true,
    encoding: "utf8",
  });
  try {
    const j = JSON.parse(r.stdout) as { nossas: string[] | string | null; node: string[] | string | null };
    const lista = (v: string[] | string | null) => (v === null ? [] : Array.isArray(v) ? v : [v]);
    return { nossas: lista(j.nossas), nodeLiberado: lista(j.node) };
  } catch {
    return { nossas: [], nodeLiberado: [] };
  }
}

export async function runChecks(dir: string, adminStatus: { host: string; port: number } | null): Promise<Item[]> {
  const itens: Item[] = [];
  const add = (nivel: Nivel, texto: string, dica?: string) => itens.push(dica ? { nivel, texto, dica } : { nivel, texto });

  // Tailscale
  const ip = await detectTailscaleIp();
  if (ip) add("ok", `Tailscale conectado; IP do PC ${ip}`);
  else add("problema", "Tailscale não encontrado ou desconectado", "Instale e entre na sua conta: https://tailscale.com/download");

  if (ip) {
    const funnel = await runTailscale(["funnel", "status"]);
    if (funnel === null || /no serve config/i.test(funnel)) add("ok", "Tailscale Funnel/Serve desligados (nada exposto à internet)");
    else add("problema", "Tailscale Funnel/Serve tem algo publicado", "Confira com: tailscale funnel status; desligue com: tailscale funnel reset");
  }

  // Servidor
  if (!adminStatus) add("aviso", "Servidor parado", "shotfolder install (ou serve)");
  else if (isTailscaleIPv4(adminStatus.host)) add("ok", `Servidor ouvindo só no Tailscale (${adminStatus.host}:${adminStatus.port})`);
  else add("aviso", `Servidor em modo de teste (${adminStatus.host}): o celular só alcança pelo cabo USB`, "Depois do Tailscale: shotfolder install (sem --local)");

  if (await readDaemonPid(dir)) add("ok", "Vigia ativo (reinicia se cair)");
  add(existsSync(shortcutPath()) ? "ok" : "aviso", existsSync(shortcutPath()) ? "Inicia com o Windows" : "Não inicia com o Windows", existsSync(shortcutPath()) ? undefined : "shotfolder install");

  // Firewall
  const fw = firewallRules();
  const temBloqueio = fw.nossas.some((n) => /bloquear/.test(n));
  const temPermissao = fw.nossas.some((n) => /permitir/.test(n));
  if (temBloqueio && temPermissao) add("ok", "Firewall: só o celular entra na porta do ShotFolder");
  else add("aviso", "Firewall: regras do ShotFolder ausentes", "shotfolder firewall --celular <IP Tailscale do celular> (gera o script para rodar como administrador)");
  if (fw.nodeLiberado.length > 0) {
    add(
      temBloqueio ? "aviso" : "problema",
      `Regras antigas liberam o node.exe em qualquer porta: ${fw.nodeLiberado.join("; ")}`,
      temBloqueio
        ? "A regra de bloqueio do ShotFolder vence na porta dele. Se não usa Node para outra coisa, pode desativar essas regras no Firewall do Windows."
        : "Crie as regras do ShotFolder (shotfolder firewall) para fechar a porta dele.",
    );
  }

  // Configuração
  const cfg = await loadConfig(dir);
  if (cfg.folders.length === 0) add("aviso", "Nenhuma pasta na lista", "shotfolder folders add <codigo> <nome> <caminho>");
  for (const f of cfg.folders) {
    const problema = await checkFolderPath(f.path, defaultForbiddenRoots(dir));
    if (problema) add("problema", `Pasta ${f.id} recusada: ${problema}`, `shotfolder folders remove ${f.id}`);
  }
  const devices = await loadDevices(dir);
  const ativos = devices.filter((d) => !d.revokedAt);
  add(ativos.length > 0 ? "ok" : "aviso", `${ativos.length} aparelho(s) ativo(s), ${devices.length - ativos.length} revogado(s)`);
  if (ativos.length > 1) add("aviso", "Mais de um aparelho ativo; confira se todos são seus", "shotfolder devices list");

  return itens;
}

export function printChecks(itens: Item[]): void {
  const rotulo: Record<Nivel, string> = { ok: "[ok]      ", aviso: "[aviso]   ", problema: "[PROBLEMA]" };
  for (const i of itens) {
    console.log(`${rotulo[i.nivel]} ${i.texto}`);
    if (i.dica) console.log(`           → ${i.dica}`);
  }
  const p = itens.filter((i) => i.nivel === "problema").length;
  const a = itens.filter((i) => i.nivel === "aviso").length;
  console.log(`\n${p} problema(s), ${a} aviso(s).`);
}
