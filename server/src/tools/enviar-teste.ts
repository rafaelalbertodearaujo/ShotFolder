#!/usr/bin/env node
/**
 * Cliente de teste no próprio PC, fazendo o papel do celular (com chave em software).
 *
 *   npm run enviar-teste -w @shotfolder/server -- parear "<texto do QR>"
 *   npm run enviar-teste -w @shotfolder/server -- pastas
 *   npm run enviar-teste -w @shotfolder/server -- enviar <foto.jpg> [codigo-da-pasta] [--repetir]
 *
 * "parear" cria uma chave de teste, manda para o PC e espera você confirmar o
 * código no "shotfolder pair". Depois disso, "pastas" e "enviar" usam o endereço
 * que veio no QR (ou --url, se informado).
 */
import { createHash, createPrivateKey, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import {
  buildFoldersCanonical,
  buildUploadCanonical,
  foldersHeaders,
  parsePairUri,
  ROUTES,
  uploadHeaders,
  type AllowedContentType,
  type UploadFields,
} from "@shotfolder/protocol";
import { pairCode } from "@shotfolder/protocol/node";
import { defaultStateDir, loadConfig } from "../state.js";

const KEY_FILE = "teste-cliente.json";
const TYPES: Record<string, AllowedContentType> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

interface TestClient {
  deviceId: string;
  privateKeyPkcs8: string;
  /** Endereço do servidor que veio no QR. */
  baseUrl: string;
}

const dir = defaultStateDir();
const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const repetir = args.includes("--repetir");
if (repetir) args.splice(args.indexOf("--repetir"), 1);
const urlArg = flag("--url");

async function baseUrl(): Promise<string> {
  if (urlArg) return urlArg.replace(/\/$/, "");
  return (await loadClient()).baseUrl;
}

async function loadClient(): Promise<TestClient> {
  try {
    return JSON.parse(await readFile(join(dir, KEY_FILE), "utf8")) as TestClient;
  } catch {
    throw new Error('Cliente de teste não pareado. Rode primeiro: parear "<texto do QR>".');
  }
}

function signWith(client: TestClient, canonical: string): string {
  const key = createPrivateKey({ key: Buffer.from(client.privateKeyPkcs8, "base64"), format: "der", type: "pkcs8" });
  return sign("sha256", Buffer.from(canonical, "utf8"), { key, dsaEncoding: "der" }).toString("base64");
}

async function parear(texto: string): Promise<void> {
  const info = parsePairUri(texto);
  if (!info) throw new Error("Texto do QR inválido.");
  const url = urlArg ?? `http://${info.host}:${info.port}`;
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const spki = publicKey.export({ format: "der", type: "spki" }).toString("base64");
  console.log(`Código no "celular": ${pairCode(info.token, spki)}  — confira com o PC e responda lá.`);
  const res = await fetch(`${url}${ROUTES.pair}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: info.token, publicKey: spki, deviceName: "cliente de teste (PC)" }),
  });
  const data = (await res.json()) as { deviceId?: string; error?: string };
  if (res.status !== 201 || !data.deviceId) throw new Error(`Pareamento falhou: ${res.status} ${data.error ?? ""}`);
  const client: TestClient = {
    deviceId: data.deviceId,
    privateKeyPkcs8: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
    baseUrl: url,
  };
  await writeFile(join(dir, KEY_FILE), JSON.stringify(client, null, 2), { flag: "w" });
  console.log(`Pareado como ${data.deviceId}.`);
}

async function pastas(): Promise<void> {
  const client = await loadClient();
  const fields = { deviceId: client.deviceId, requestId: randomUUID(), timestamp: String(Date.now()) };
  const res = await fetch(`${await baseUrl()}${ROUTES.folders}`, {
    headers: foldersHeaders(fields, signWith(client, buildFoldersCanonical(fields))),
  });
  console.log(res.status, await res.text());
}

async function enviar(arquivo: string, pasta: string | undefined): Promise<void> {
  const client = await loadClient();
  const contentType = TYPES[extname(arquivo).toLowerCase()];
  if (!contentType) throw new Error("Use .jpg, .png ou .webp.");
  const body = await readFile(arquivo);
  const folderId = pasta ?? (await loadConfig(dir)).defaultFolder;
  if (!folderId) throw new Error("Informe o código da pasta (não há pasta padrão).");
  const uploadId = randomUUID();

  const vezes = repetir ? 2 : 1;
  for (let i = 0; i < vezes; i++) {
    const fields: UploadFields = {
      deviceId: client.deviceId,
      uploadId,
      timestamp: String(Date.now()),
      folderId,
      contentType,
      contentLength: String(body.length),
      sha256: createHash("sha256").update(body).digest("hex"),
    };
    const res = await fetch(`${await baseUrl()}${ROUTES.upload}`, {
      method: "POST",
      headers: uploadHeaders(fields, signWith(client, buildUploadCanonical(fields))),
      body,
    });
    console.log(`${i === 0 ? "envio" : "repetição"}: ${res.status} ${await res.text()}`);
  }
}

const [cmd, a1, a2] = args;
const tarefas: Record<string, () => Promise<void>> = {
  parear: () => {
    if (!a1) throw new Error('Uso: parear "<texto do QR>"');
    return parear(a1);
  },
  pastas,
  enviar: () => {
    if (!a1) throw new Error("Uso: enviar <foto.jpg> [codigo-da-pasta] [--repetir]");
    return enviar(a1, a2);
  },
};
const tarefa = cmd ? tarefas[cmd] : undefined;
if (!tarefa) {
  console.log('Comandos: parear "<QR>" | pastas | enviar <foto> [pasta] [--repetir]  (opção --url http://IP:porta)');
  process.exit(1);
}
tarefa().catch((e: unknown) => {
  console.error(`Erro: ${(e as Error).message}`);
  process.exit(1);
});
