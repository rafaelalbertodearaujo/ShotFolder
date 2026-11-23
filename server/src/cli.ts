#!/usr/bin/env node
/**
 * Linha de comando do ShotFolder no PC.
 *
 *   shotfolder serve [--local]                       inicia o servidor
 *   shotfolder pair                                  mostra o QR e confirma o celular
 *   shotfolder folders list
 *   shotfolder folders add <codigo> <nome> <caminho> [--padrao]
 *   shotfolder folders remove <codigo>
 *   shotfolder folders default <codigo>
 *   shotfolder devices list
 *   shotfolder devices revoke <deviceId>
 *   shotfolder log [quantidade]
 *
 * Só "pair" precisa do servidor rodando. O resto mexe direto nos arquivos de
 * estado, então revogar um aparelho funciona mesmo com o servidor parado.
 */
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { renderUnicodeCompact } from "uqr";
import { PATTERNS } from "@shotfolder/protocol";
import { checkFolderPath, defaultForbiddenRoots } from "./files.js";
import type { PairStatus } from "./pairing.js";
import { serve } from "./serve.js";
import {
  audit,
  defaultStateDir,
  ensureStateDir,
  FILES,
  loadConfig,
  loadDevices,
  saveDevices,
  updateConfig,
  type FolderEntry,
} from "./state.js";

const dir = defaultStateDir();

class UsageError extends Error {}

// ---------- pastas ----------

async function foldersList(): Promise<void> {
  const cfg = await loadConfig(dir);
  if (cfg.folders.length === 0) {
    console.log("Nenhuma pasta na lista. Use: shotfolder folders add <codigo> <nome> <caminho>");
    return;
  }
  for (const f of cfg.folders) {
    const problem = await checkFolderPath(f.path, defaultForbiddenRoots(dir));
    const padrao = f.id === cfg.defaultFolder ? " (padrão)" : "";
    console.log(`${problem ? "[RECUSADA]" : "[ok]      "} ${f.id}${padrao} — ${f.name}\n           ${f.path}${problem ? `\n           motivo: ${problem}` : ""}`);
  }
}

async function foldersAdd(id: string, name: string, path: string, padrao: boolean): Promise<void> {
  if (!PATTERNS.folderId.test(id)) throw new UsageError("Código inválido: use minúsculas, dígitos e hífen (até 32).");
  const full = resolve(path);
  const problem = await checkFolderPath(full, defaultForbiddenRoots(dir));
  if (problem) throw new UsageError(`Pasta recusada: ${problem}.`);
  await updateConfig(dir, (raw) => {
    const folders: FolderEntry[] = raw.folders ?? [];
    if (folders.some((f) => f.id === id)) throw new UsageError(`Já existe a pasta ${id}.`);
    folders.push({ id, name, path: full });
    raw.folders = folders;
    if (padrao || !raw.defaultFolder) raw.defaultFolder = id;
  });
  await audit(dir, Date.now(), { event: "folder_added", folder: id, path: full });
  console.log(`Pasta ${id} adicionada → ${full}`);
}

async function foldersRemove(id: string): Promise<void> {
  await updateConfig(dir, (raw) => {
    const folders = raw.folders ?? [];
    if (!folders.some((f) => f.id === id)) throw new UsageError(`Pasta ${id} não está na lista.`);
    raw.folders = folders.filter((f) => f.id !== id);
    if (raw.defaultFolder === id) {
      const primeira = raw.folders[0]?.id;
      if (primeira) raw.defaultFolder = primeira;
      else delete raw.defaultFolder;
    }
  });
  await audit(dir, Date.now(), { event: "folder_removed", folder: id });
  console.log(`Pasta ${id} removida da lista (os arquivos dela continuam no disco).`);
}

async function foldersDefault(id: string): Promise<void> {
  await updateConfig(dir, (raw) => {
    if (!(raw.folders ?? []).some((f) => f.id === id)) throw new UsageError(`Pasta ${id} não está na lista.`);
    raw.defaultFolder = id;
  });
  console.log(`Pasta padrão: ${id}`);
}

// ---------- aparelhos ----------

async function devicesList(): Promise<void> {
  const devices = await loadDevices(dir);
  if (devices.length === 0) {
    console.log("Nenhum aparelho pareado. Use: shotfolder pair");
    return;
  }
  for (const d of devices) {
    const estado = d.revokedAt ? `REVOGADO em ${d.revokedAt}` : "ativo";
    console.log(`${d.id}  ${d.name}  (pareado em ${d.createdAt}; ${estado})`);
  }
}

async function devicesRevoke(id: string): Promise<void> {
  const devices = await loadDevices(dir);
  const d = devices.find((x) => x.id === id);
  if (!d) throw new UsageError(`Aparelho ${id} não encontrado. Veja: shotfolder devices list`);
  if (d.revokedAt) {
    console.log(`${id} já estava revogado.`);
    return;
  }
  d.revokedAt = new Date().toISOString();
  await saveDevices(dir, devices);
  await audit(dir, Date.now(), { event: "device_revoked", deviceId: id });
  console.log(`Aparelho ${id} (${d.name}) revogado. Vale na hora, mesmo com o servidor rodando.`);
}

// ---------- log ----------

async function showLog(n: number): Promise<void> {
  let text = "";
  try {
    text = await readFile(join(dir, FILES.audit), "utf8");
  } catch {
    console.log("Log vazio.");
    return;
  }
  for (const line of text.trim().split("\n").slice(-n)) {
    try {
      const { at, event, ...rest } = JSON.parse(line) as Record<string, unknown>;
      const extra = Object.entries(rest)
        .map(([k, v]) => `${k}=${String(v)}`)
        .join(" ");
      console.log(`${String(at)}  ${String(event)}  ${extra}`);
    } catch {
      console.log(`(linha ilegível) ${line}`);
    }
  }
}

// ---------- pareamento ----------

async function adminRequest(method: "GET" | "POST", path: string, body?: unknown): Promise<unknown> {
  const cfg = await loadConfig(dir);
  let token: string;
  try {
    token = (await readFile(join(dir, FILES.adminToken), "utf8")).trim();
  } catch {
    throw new UsageError("Servidor não está rodando (sem admin.token). Inicie com: shotfolder serve");
  }
  let res: Response;
  try {
    res = await fetch(`http://127.0.0.1:${cfg.adminPort}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new UsageError("Não consegui falar com o servidor. Ele está rodando? (shotfolder serve)");
  }
  const data = (await res.json()) as unknown;
  if (res.status === 403) throw new UsageError("API admin recusou o token. Reinicie o servidor e tente de novo.");
  return data;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function pair(): Promise<void> {
  const { uri, expiresAt } = (await adminRequest("POST", "/admin/pair/start")) as { uri: string; expiresAt: number };
  console.log("\nAbra o ShotFolder no celular e leia este QR:\n");
  console.log(renderUnicodeCompact(uri, { border: 2 }));
  console.log(`\nTexto do QR: ${uri}`);
  console.log(`Vale até ${new Date(expiresAt).toLocaleTimeString("pt-BR")} e só uma vez. Ctrl+C cancela.\n`);

  let cancelado = false;
  process.once("SIGINT", () => {
    cancelado = true;
    void adminRequest("POST", "/admin/pair/cancel").finally(() => {
      console.log("\nPareamento cancelado.");
      process.exit(130);
    });
  });

  while (!cancelado) {
    const st = (await adminRequest("GET", "/admin/pair/status")) as PairStatus;
    if (st.phase === "none") throw new UsageError("O QR expirou ou foi cancelado. Rode shotfolder pair de novo.");
    if (st.phase === "confirming") {
      console.log(`Aparelho "${st.deviceName}" quer parear.`);
      console.log(`Código no PC: ${st.code}`);
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const resposta = (await rl.question("O celular mostra exatamente este código? (s/n) ")).trim().toLowerCase();
      rl.close();
      const accept = resposta === "s" || resposta === "sim";
      const r = (await adminRequest("POST", "/admin/pair/confirm", { accept })) as { ok: boolean; deviceId?: string; error?: string };
      if (!r.ok) throw new UsageError(`Não deu para confirmar: ${r.error ?? "erro"}`);
      console.log(accept ? `Pareado! deviceId: ${r.deviceId}` : "Recusado. Nenhum aparelho foi adicionado.");
      return;
    }
    await sleep(1000);
  }
}

// ---------- roteamento ----------

const AJUDA = `Uso:
  shotfolder serve [--local]
  shotfolder pair
  shotfolder folders list | add <codigo> <nome> <caminho> [--padrao] | remove <codigo> | default <codigo>
  shotfolder devices list | revoke <deviceId>
  shotfolder log [quantidade]`;

async function main(argv: string[]): Promise<void> {
  const flags = new Set(argv.filter((a) => a.startsWith("--")));
  const [cmd, sub, ...rest] = argv.filter((a) => !a.startsWith("--"));
  await ensureStateDir(dir);
  switch (cmd) {
    case "serve":
      return serve(flags.has("--local"));
    case "pair":
      return pair();
    case "folders":
      if (sub === "list" || sub === undefined) return foldersList();
      if (sub === "add" && rest.length === 3) return foldersAdd(rest[0]!, rest[1]!, rest[2]!, flags.has("--padrao"));
      if (sub === "remove" && rest[0]) return foldersRemove(rest[0]);
      if (sub === "default" && rest[0]) return foldersDefault(rest[0]);
      break;
    case "devices":
      if (sub === "list" || sub === undefined) return devicesList();
      if (sub === "revoke" && rest[0]) return devicesRevoke(rest[0]);
      break;
    case "log":
      return showLog(sub ? Math.max(1, Number(sub) || 20) : 20);
  }
  throw new UsageError(AJUDA);
}

main(process.argv.slice(2)).catch((e: unknown) => {
  console.error(e instanceof UsageError ? e.message : `Erro: ${(e as Error).message}`);
  process.exit(1);
});
