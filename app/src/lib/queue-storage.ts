/**
 * Armazenamento da fila nos arquivos privados do app (Paths.document/fila):
 *   fila/index.json      a lista de itens
 *   fila/<uploadId>.jpg  as fotos esperando envio (já sem EXIF)
 * Só o próprio app lê essa pasta. A foto é apagada assim que o PC confirma.
 */
import { Directory, File, Paths } from "expo-file-system";
import type { QueueItem, QueueStorage } from "./queue";

const NOME_SEGURO = /^[0-9a-f-]{36}\.jpg$/;

export class FileQueueStorage implements QueueStorage {
  private readonly dir = new Directory(Paths.document, "fila");

  private pasta(): Directory {
    if (!this.dir.exists) this.dir.create({ intermediates: true });
    return this.dir;
  }

  private foto(nome: string): File {
    if (!NOME_SEGURO.test(nome)) throw new Error("Nome de arquivo da fila inválido.");
    return new File(this.pasta(), nome);
  }

  async load(): Promise<QueueItem[]> {
    const idx = new File(this.pasta(), "index.json");
    if (!idx.exists) return [];
    try {
      const data = JSON.parse(await idx.text()) as unknown;
      return Array.isArray(data) ? (data as QueueItem[]) : [];
    } catch {
      return [];
    }
  }

  async save(items: QueueItem[]): Promise<void> {
    // Grava num temporário e troca: o índice nunca fica pela metade.
    const tmp = new File(this.pasta(), "index.json.tmp");
    await tmp.write(JSON.stringify(items));
    await tmp.move(new File(this.pasta(), "index.json"), { overwrite: true });
  }

  async writePhoto(nome: string, bytes: Uint8Array): Promise<void> {
    await this.foto(nome).write(bytes);
  }

  async readPhoto(nome: string): Promise<Uint8Array> {
    return this.foto(nome).bytes();
  }

  async deletePhoto(nome: string): Promise<void> {
    const f = this.foto(nome);
    if (f.exists) f.delete();
  }
}
