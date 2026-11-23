/**
 * Fila de envio contra o servidor de verdade: PC desligado, PC volta, resposta perdida,
 * pasta que saiu da lista, aparelho revogado. Só o armazenamento é em memória.
 */
import { generateKeyPairSync, randomUUID, sign, type KeyObject } from "node:crypto";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp, createPairing } from "../../server/src/app";
import type { Pairing } from "../../server/src/pairing";
import { loadDevices, saveDevices } from "../../server/src/state";
import { ApiError, pairWithPc, uploadPhoto, type Session } from "../src/lib/api";
import { pairCodeFor, type Signer } from "../src/lib/crypto";
import { BACKOFF_MS, UploadQueue, type QueueItem, type QueueStorage } from "../src/lib/queue";
import { APP0, DQT, jpegCom, SCAN } from "./jpeg-fixture";

class MemoriaFila implements QueueStorage {
  itens: QueueItem[] = [];
  fotos = new Map<string, Uint8Array>();
  async load() {
    return this.itens.map((i) => ({ ...i }));
  }
  async save(items: QueueItem[]) {
    this.itens = items.map((i) => ({ ...i }));
  }
  async writePhoto(n: string, b: Uint8Array) {
    this.fotos.set(n, b);
  }
  async readPhoto(n: string) {
    const b = this.fotos.get(n);
    if (!b) throw new Error("sumiu");
    return b;
  }
  async deletePhoto(n: string) {
    this.fotos.delete(n);
  }
}

class Chave implements Signer {
  readonly publicKeySpki: string;
  private readonly key: KeyObject;
  constructor() {
    const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    this.key = privateKey;
    this.publicKeySpki = publicKey.export({ format: "der", type: "spki" }).toString("base64");
  }
  async sign(t: string) {
    return sign("sha256", Buffer.from(t), { key: this.key, dsaEncoding: "der" }).toString("base64");
  }
}

let base: string;
let estado: string;
let fotos: string;
let pairing: Pairing;
let app: FastifyInstance | null;
let port: number;
let session: Session;
let signer: Chave;
let relogio: number;

async function ligar(): Promise<void> {
  app = await buildApp({ stateDir: estado, pairing, forbiddenRoots: [] });
  await app.listen({ host: "127.0.0.1", port });
}
async function desligar(): Promise<void> {
  await app?.close();
  app = null;
}

const jpeg = (n: number) => jpegCom(APP0, DQT, Uint8Array.from([0xff, 0xfe, 0x00, 0x03, n]), SCAN);

function novaFila(storage = new MemoriaFila(), envio?: (i: QueueItem, b: Uint8Array) => Promise<never | Awaited<ReturnType<typeof uploadPhoto>>>) {
  const upload = envio ?? ((i: QueueItem, b: Uint8Array) =>
    uploadPhoto(session, signer, i.folderId, b, { now: Date.now, uuid: randomUUID }, { uploadId: i.uploadId }));
  return { fila: new UploadQueue(storage, upload, () => relogio), storage };
}

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "shotfolder-fila-"));
  estado = join(base, "estado");
  fotos = join(base, "fotos");
  await mkdir(estado);
  await mkdir(fotos);
  await mkdir(join(base, "outra"));
  await writeFile(
    join(estado, "config.json"),
    JSON.stringify({
      folders: [
        { id: "fotos", name: "Fotos", path: fotos },
        { id: "outra", name: "Outra", path: join(base, "outra") },
      ],
      defaultFolder: "fotos",
    }),
  );
  pairing = createPairing(estado, Date.now, 2000);
  app = await buildApp({ stateDir: estado, pairing, forbiddenRoots: [] });
  await app.listen({ host: "127.0.0.1", port: 0 });
  port = (app.server.address() as AddressInfo).port;
  relogio = 1_000_000;

  signer = new Chave();
  const { token } = pairing.start();
  const confirmar = (async () => {
    for (let i = 0; i < 100; i++) {
      if (pairing.status().phase === "confirming") return pairing.confirm(true);
      await new Promise((r) => setTimeout(r, 10));
    }
  })();
  [session] = await Promise.all([pairWithPc({ host: "127.0.0.1", port, token }, signer, "Celular"), confirmar]);
  expect(pairCodeFor(token, signer.publicKeySpki)).toMatch(/^\d{6}$/);
});

afterEach(async () => {
  pairing.cancel();
  await desligar();
  await rm(base, { recursive: true, force: true });
});

describe("fila de envio", () => {
  it("PC desligado: 3 fotos esperam; PC volta: as 3 chegam uma vez só", async () => {
    await desligar();
    const { fila, storage } = novaFila();
    for (const n of [1, 2, 3]) await fila.enqueue(jpeg(n), { id: "fotos", name: "Fotos" }, randomUUID());

    const r1 = await fila.process();
    expect(r1.parouPor).toBe("network");
    expect(r1.pendentes).toBe(3);
    expect(storage.fotos.size).toBe(3);

    await ligar();
    const r2 = await fila.process({ ignorarEspera: true });
    expect(r2.enviadas).toHaveLength(3);
    expect(r2.pendentes).toBe(0);
    expect(await readdir(fotos)).toHaveLength(3);
    expect(storage.fotos.size).toBe(0); // fotos apagadas do celular depois de entregues

    // rodar de novo não manda nada
    expect((await fila.process({ ignorarEspera: true })).enviadas).toHaveLength(0);
    expect(await readdir(fotos)).toHaveLength(3);
  });

  it("resposta perdida no caminho: o reenvio vira 'já recebido' e não duplica", async () => {
    let primeira = true;
    const { fila } = novaFila(new MemoriaFila(), async (i, b) => {
      const r = await uploadPhoto(session, signer, i.folderId, b, { now: Date.now, uuid: randomUUID }, { uploadId: i.uploadId });
      if (primeira) {
        primeira = false;
        throw new ApiError("network", "conexão caiu depois de enviar");
      }
      return r;
    });
    await fila.enqueue(jpeg(1), { id: "fotos", name: "Fotos" }, randomUUID());
    await fila.process();
    const r = await fila.process({ ignorarEspera: true });
    expect(r.enviadas[0]?.result.status).toBe("duplicate");
    expect(await readdir(fotos)).toHaveLength(1);
  });

  it("espera crescente: antes do prazo não tenta de novo", async () => {
    await desligar();
    let tentativas = 0;
    const { fila } = novaFila(new MemoriaFila(), async (i, b) => {
      tentativas++;
      return uploadPhoto(session, signer, i.folderId, b, { now: Date.now, uuid: randomUUID }, { uploadId: i.uploadId });
    });
    await fila.enqueue(jpeg(1), { id: "fotos", name: "Fotos" }, randomUUID());
    await fila.process();
    expect(tentativas).toBe(1);
    relogio += BACKOFF_MS[0]! - 1;
    await fila.process();
    expect(tentativas).toBe(1);
    relogio += 2;
    await fila.process();
    expect(tentativas).toBe(2);
    expect((await fila.list())[0]?.nextAttemptAt).toBe(relogio + BACKOFF_MS[1]!);
  });

  it("pasta que saiu da lista: falha com motivo; tentar em outra pasta funciona", async () => {
    const { fila } = novaFila();
    const item = await fila.enqueue(jpeg(1), { id: "sumiu", name: "Sumiu" }, randomUUID());
    const r = await fila.process();
    expect(r.falhas[0]?.lastErrorCode).toBe("unknown_folder");
    expect((await fila.list())[0]?.status).toBe("falhou");
    // falhou não é tentada de novo sozinha
    expect((await fila.process({ ignorarEspera: true })).enviadas).toHaveLength(0);
    await fila.retry(item.uploadId, { id: "outra", name: "Outra" });
    expect((await fila.process()).enviadas).toHaveLength(1);
    expect(await readdir(join(base, "outra"))).toHaveLength(1);
  });

  it("aparelho revogado: para tudo e marca como falha", async () => {
    const devices = await loadDevices(estado);
    await saveDevices(estado, devices.map((d) => ({ ...d, revokedAt: new Date().toISOString() })));
    const { fila } = novaFila();
    await fila.enqueue(jpeg(1), { id: "fotos", name: "Fotos" }, randomUUID());
    await fila.enqueue(jpeg(2), { id: "fotos", name: "Fotos" }, randomUUID());
    const r = await fila.process();
    expect(r.parouPor).toBe("unauthorized");
    expect(r.falhas).toHaveLength(1); // parou na primeira
  });

  it("duas chamadas ao mesmo tempo enviam uma vez só", async () => {
    let chamadas = 0;
    const { fila } = novaFila(new MemoriaFila(), async (i, b) => {
      chamadas++;
      return uploadPhoto(session, signer, i.folderId, b, { now: Date.now, uuid: randomUUID }, { uploadId: i.uploadId });
    });
    await fila.enqueue(jpeg(1), { id: "fotos", name: "Fotos" }, randomUUID());
    await Promise.all([fila.process(), fila.process(), fila.process()]);
    expect(chamadas).toBe(1);
  });

  it("descartar apaga a foto do celular", async () => {
    const { fila, storage } = novaFila();
    const item = await fila.enqueue(jpeg(1), { id: "fotos", name: "Fotos" }, randomUUID());
    await fila.discard(item.uploadId);
    expect(storage.fotos.size).toBe(0);
    expect(await fila.list()).toEqual([]);
  });

  it("a fila sobrevive a fechar o app (recarrega do armazenamento)", async () => {
    await desligar();
    const storage = new MemoriaFila();
    await novaFila(storage).fila.enqueue(jpeg(1), { id: "fotos", name: "Fotos" }, randomUUID());
    await ligar();
    const { fila } = novaFila(storage); // "app reaberto"
    expect((await fila.process()).enviadas).toHaveLength(1);
  });

  it("avisa a tela quando muda", async () => {
    const { fila } = novaFila();
    const vistos: number[] = [];
    fila.subscribe((items) => vistos.push(items.length));
    await fila.enqueue(jpeg(1), { id: "fotos", name: "Fotos" }, randomUUID());
    await fila.process();
    expect(vistos).toEqual([1, 0]);
  });
});
