/**
 * Regras do Firewall do Windows para a porta do ShotFolder.
 *
 * Duas regras de entrada, só para a porta pública (47800):
 *   1. PERMITIR: só do IP Tailscale do celular, só para o IP Tailscale do PC, só o node.exe.
 *   2. BLOQUEAR: de qualquer outro IP. No Firewall do Windows, bloqueio vence permissão —
 *      então isso vale mesmo que existam regras antigas "Node.js JavaScript Runtime"
 *      liberando o node.exe para tudo (o Windows cria essas quando você clica "Permitir").
 *
 * Criar regra de firewall exige administrador: este módulo só GERA o script; você roda.
 */
import { isTailscaleIPv4 } from "./net.js";

export const RULE_PREFIX = "ShotFolder";

export function ipToInt(ip: string): number {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) throw new Error(`IP inválido: ${ip}`);
  return ((p[0]! << 24) >>> 0) + (p[1]! << 16) + (p[2]! << 8) + p[3]!;
}

export function intToIp(n: number): string {
  return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
}

/** Todas as faixas IPv4 menos um IP (o Firewall não tem "todos exceto"). */
export function allExcept(ip: string): string[] {
  const n = ipToInt(ip);
  const out: string[] = [];
  if (n > 0) out.push(`0.0.0.0-${intToIp(n - 1)}`);
  if (n < 0xffffffff) out.push(`${intToIp(n + 1)}-255.255.255.255`);
  return out;
}

export interface FirewallOptions {
  phoneIp: string;
  pcIp: string;
  port: number;
  nodePath: string;
}

const psQuote = (s: string) => `'${s.replace(/'/g, "''")}'`;

export function firewallScript(o: FirewallOptions): string {
  if (!isTailscaleIPv4(o.phoneIp)) throw new Error(`O IP do celular precisa ser do Tailscale (100.64.x.x a 100.127.x.x): ${o.phoneIp}`);
  if (!isTailscaleIPv4(o.pcIp)) throw new Error(`O IP do PC precisa ser do Tailscale: ${o.pcIp}`);
  if (o.phoneIp === o.pcIp) throw new Error("O IP do celular e o do PC são iguais.");
  const bloquear = allExcept(o.phoneIp).map(psQuote).join(", ");
  return `#Requires -RunAsAdministrator
# Gerado por "shotfolder firewall". Cria (ou recria) as regras do ShotFolder.
# Para desfazer: Get-NetFirewallRule -DisplayName '${RULE_PREFIX}*' | Remove-NetFirewallRule
$ErrorActionPreference = 'Stop'

Get-NetFirewallRule -DisplayName '${RULE_PREFIX}*' -ErrorAction SilentlyContinue | Remove-NetFirewallRule

New-NetFirewallRule -DisplayName '${RULE_PREFIX} - permitir celular' -Direction Inbound -Action Allow \`
  -Protocol TCP -LocalPort ${o.port} -RemoteAddress ${psQuote(o.phoneIp)} -LocalAddress ${psQuote(o.pcIp)} \`
  -Program ${psQuote(o.nodePath)} -Profile Any | Out-Null

New-NetFirewallRule -DisplayName '${RULE_PREFIX} - bloquear outros' -Direction Inbound -Action Block \`
  -Protocol TCP -LocalPort ${o.port} -RemoteAddress @(${bloquear}) -Profile Any | Out-Null

Get-NetFirewallRule -DisplayName '${RULE_PREFIX}*' | Format-Table DisplayName, Action, Enabled -AutoSize
Write-Host 'Regras do ShotFolder criadas.'
`;
}
