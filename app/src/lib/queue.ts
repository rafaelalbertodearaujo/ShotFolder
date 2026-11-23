/**
 * Fila de envio (etapa 7). Sem nada nativo: o armazenamento e o envio são injetados,
 * então a mesma lógica roda no celular e nos testes do Node.
 *
 * - Toda foto passa pela fila: primeiro é guardada no celular, depois enviada.
 * - Cada foto tem um uploadId fixo: reenviar nunca duplica no PC ("já recebido" = sucesso).
 * - Falha de rede / PC desligado / celular bloqueado: espera crescente e tenta de novo.
 * - Erro definitivo (pasta saiu da lista, aparelho revogado…): a foto fica marcada como
 *   "falhou" com o motivo, para você tentar de novo, trocar de pasta ou descartar.
 */
import { ApiError, type UploadResult } from "./api";

export type ItemStatus = "pendente" | "falhou";

export interface QueueItem {
  uploadId: string;
  folderId: string;
  folderName: string;
  /** Nome do arquivo guardado pelo armazenamento da fila. */
  fileName: string;
  bytes: number;
  createdAt: number;
  attempts: number;
  nextAttemptAt: number;
  status: ItemStatus;
  lastErrorCode?: string;
  lastError?: string;
}

export interface QueueStorage {
  load(): Promise<QueueItem[]>;
  save(items: QueueItem[]): Promise<void>;
  writePhoto(fileName: string, bytes: Uint8Array): Promise<void>;
  readPhoto(fileName: string): Promise<Uint8Array>;
  deletePhoto(fileName: string): Promise<void>;
}

export type Uploader = (item: QueueItem, jpeg: Uint8Array) => Promise<UploadResult>;

/** Erros que não adianta repetir sozinho. */
const DEFINITIVOS = new Set(["unknown_folder", "content_mismatch", "too_large", "upload_id_conflict"]);
/** Erros que valem para a fila inteira: param o processamento agora. */
const PARAM_TUDO = new Set(["network", "key_locked", "unauthorized", "insufficient_storage", "rate_limited", "daily_quota"]);

/** Espera antes da próxima tentativa: 30 s, 1, 2, 5, 15, 30 min e depois 1 h. */
export const BACKOFF_MS = [30_000, 60_000, 120_000, 300_000, 900_000, 1_800_000, 3_600_000];
export const backoff = (attempts: number) => BACKOFF_MS[Math.min(Math.max(attempts - 1, 0), BACKOFF_MS.length - 1)]!;

export interface ProcessSummary {
  enviadas: Array<{ item: QueueItem; result: UploadResult }>;
  falhas: QueueItem[];
  pendentes: number;
  /** Código do erro que fez parar (rede, bloqueado, revogado…), se parou. */
  parouPor?: string;
}

export class UploadQueue {
  private items: QueueItem[] = [];
  private carregado = false;
  private rodando: Promise<ProcessSummary> | null = null;
  private ouvintes = new Set<(items: QueueItem[]) => void>();

  constructor(
    private readonly storage: QueueStorage,
    private readonly upload: Uploader,
    private readonly now: () => number = Date.now,
  ) {}

  private async garantirCarregado(): Promise<void> {
    if (this.carregado) return;
    this.items = await this.storage.load();
    this.carregado = true;
  }

  private async salvar(): Promise<void> {
    await this.storage.save(this.items);
    const copia = this.items.map((i) => ({ ...i }));
    for (const f of this.ouvintes) f(copia);
  }

  /** Avisa a tela sempre que a fila muda. Devolve a função para parar de ouvir. */
  subscribe(f: (items: QueueItem[]) => void): () => void {
    this.ouvintes.add(f);
    return () => this.ouvintes.delete(f);
  }

  async list(): Promise<QueueItem[]> {
    await this.garantirCarregado();
    return this.items.map((i) => ({ ...i }));
  }

  /** Guarda a foto na fila. Depois chame `process()`. */
  async enqueue(jpeg: Uint8Array, folder: { id: string; name: string }, uploadId: string): Promise<QueueItem> {
    await this.garantirCarregado();
    const item: QueueItem = {
      uploadId,
      folderId: folder.id,
      folderName: folder.name,
      fileName: `${uploadId}.jpg`,
      bytes: jpeg.length,
      createdAt: this.now(),
      attempts: 0,
      nextAttemptAt: 0,
      status: "pendente",
    };
    await this.storage.writePhoto(item.fileName, jpeg);
    this.items.push(item);
    await this.salvar();
    return { ...item };
  }

  /** Envia o que estiver na hora. Só um processamento por vez (chamadas juntas esperam o mesmo). */
  process(opts: { ignorarEspera?: boolean } = {}): Promise<ProcessSummary> {
    if (!this.rodando) {
      this.rodando = this.processar(opts).finally(() => {
        this.rodando = null;
      });
    }
    return this.rodando;
  }

  private async processar(opts: { ignorarEspera?: boolean }): Promise<ProcessSummary> {
    await this.garantirCarregado();
    const resumo: ProcessSummary = { enviadas: [], falhas: [], pendentes: 0 };
    const fila = [...this.items]
      .filter((i) => i.status === "pendente" && (opts.ignorarEspera || i.nextAttemptAt <= this.now()))
      .sort((a, b) => a.createdAt - b.createdAt);

    for (const item of fila) {
      let jpeg: Uint8Array;
      try {
        jpeg = await this.storage.readPhoto(item.fileName);
      } catch {
        this.marcarFalha(item, "arquivo_sumiu", "A foto guardada no celular sumiu. Descarte este item.");
        resumo.falhas.push({ ...item });
        await this.salvar();
        continue;
      }
      try {
        const result = await this.upload(item, jpeg);
        this.items = this.items.filter((i) => i.uploadId !== item.uploadId);
        await this.storage.deletePhoto(item.fileName).catch(() => {});
        resumo.enviadas.push({ item: { ...item }, result });
        await this.salvar();
      } catch (e) {
        const code = e instanceof ApiError ? e.code : "unknown";
        const msg = e instanceof Error ? e.message : "Erro inesperado.";
        item.attempts += 1;
        item.lastErrorCode = code;
        item.lastError = msg;
        if (DEFINITIVOS.has(code) || code === "unauthorized") {
          this.marcarFalha(item, code, msg);
          resumo.falhas.push({ ...item });
        } else {
          item.nextAttemptAt = this.now() + backoff(item.attempts);
        }
        await this.salvar();
        if (PARAM_TUDO.has(code)) {
          resumo.parouPor = code;
          break;
        }
      }
    }
    resumo.pendentes = this.items.filter((i) => i.status === "pendente").length;
    return resumo;
  }

  private marcarFalha(item: QueueItem, code: string, msg: string): void {
    item.status = "falhou";
    item.lastErrorCode = code;
    item.lastError = msg;
  }

  /** Volta para a fila e tenta já na próxima rodada (opcionalmente em outra pasta). */
  async retry(uploadId: string, folder?: { id: string; name: string }): Promise<void> {
    await this.garantirCarregado();
    const item = this.items.find((i) => i.uploadId === uploadId);
    if (!item) return;
    item.status = "pendente";
    item.nextAttemptAt = 0;
    if (folder) {
      item.folderId = folder.id;
      item.folderName = folder.name;
    }
    await this.salvar();
  }

  /** Tira da fila e apaga a foto do celular. */
  async discard(uploadId: string): Promise<void> {
    await this.garantirCarregado();
    const item = this.items.find((i) => i.uploadId === uploadId);
    if (!item) return;
    this.items = this.items.filter((i) => i.uploadId !== uploadId);
    await this.storage.deletePhoto(item.fileName).catch(() => {});
    await this.salvar();
  }

  /** Quando é a próxima tentativa agendada (para o app saber quando acordar de novo). */
  async nextDue(): Promise<number | null> {
    await this.garantirCarregado();
    const pend = this.items.filter((i) => i.status === "pendente").map((i) => i.nextAttemptAt);
    return pend.length ? Math.min(...pend) : null;
  }
}
