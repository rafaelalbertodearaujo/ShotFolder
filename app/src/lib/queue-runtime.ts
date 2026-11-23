/**
 * A fila "de verdade" do app (uma só, usada pelas telas e pela tarefa em segundo plano).
 *
 * Gatilhos de envio:
 *   - ao enviar uma foto (na hora);
 *   - ao abrir/voltar para o app e quando a rede volta (queue-context.tsx);
 *   - tarefa em segundo plano do Android, no máximo a cada ~15 min, quando o sistema deixar.
 */
import * as BackgroundTask from "expo-background-task";
import { randomUUID } from "expo-crypto";
import * as TaskManager from "expo-task-manager";
import { ApiError, uploadPhoto } from "./api";
import { UploadQueue } from "./queue";
import { FileQueueStorage } from "./queue-storage";
import { loadPaired } from "./storage";

export const queue = new UploadQueue(new FileQueueStorage(), async (item, jpeg) => {
  const paired = await loadPaired();
  if (!paired) throw new ApiError("unauthorized", "Este celular não está pareado. Pareie de novo.");
  return uploadPhoto(
    paired.session,
    paired.signer,
    item.folderId,
    jpeg,
    { now: Date.now, uuid: randomUUID },
    { uploadId: item.uploadId },
  );
});

export const BACKGROUND_TASK = "shotfolder-fila";

// Precisa ser definido no carregamento do app (escopo global), antes de qualquer tela.
TaskManager.defineTask(BACKGROUND_TASK, async () => {
  try {
    await queue.process();
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

/** Registra a tarefa periódica (uma vez; o Android lembra entre aberturas). */
export async function ensureBackgroundTask(): Promise<void> {
  try {
    if (await TaskManager.isTaskRegisteredAsync(BACKGROUND_TASK)) return;
    await BackgroundTask.registerTaskAsync(BACKGROUND_TASK, { minimumInterval: 15 });
  } catch {
    // Sem tarefa de fundo (ex.: restrição de bateria): a fila ainda anda com o app aberto.
  }
}
