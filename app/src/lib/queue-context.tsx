/**
 * Liga a fila às telas: mantém a lista atualizada e dispara envios quando o app abre,
 * quando volta do segundo plano, quando a rede volta e a cada 20 s com o app aberto.
 */
import NetInfo from "@react-native-community/netinfo";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import type { ProcessSummary, QueueItem } from "./queue";
import { ensureBackgroundTask, queue } from "./queue-runtime";

interface QueueState {
  items: QueueItem[];
  /** Tenta enviar o que estiver na hora (ou tudo, com `agora`). */
  kick: (agora?: boolean) => Promise<ProcessSummary | null>;
  /** Guarda a foto e tenta enviar na hora. */
  enqueueAndSend: (
    jpeg: Uint8Array,
    folder: { id: string; name: string },
    uploadId: string,
  ) => Promise<ProcessSummary | null>;
  retry: (uploadId: string, folder?: { id: string; name: string }) => Promise<void>;
  discard: (uploadId: string) => Promise<void>;
}

const Ctx = createContext<QueueState | null>(null);

export function QueueProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<QueueItem[]>([]);

  const kick = useCallback(async (agora = false) => {
    try {
      return await queue.process({ ignorarEspera: agora });
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    const parar = queue.subscribe(setItems);
    void queue.list().then(setItems);
    void ensureBackgroundTask();
    void kick();

    const app = AppState.addEventListener("change", (s) => {
      if (s === "active") void kick();
    });
    let conectadoAntes: boolean | null = null;
    const rede = NetInfo.addEventListener((st) => {
      // A rede voltou: tenta já, sem esperar o prazo.
      if (st.isConnected && conectadoAntes === false) void kick(true);
      conectadoAntes = st.isConnected;
    });
    const timer = setInterval(() => {
      if (AppState.currentState === "active") void kick();
    }, 20_000);

    return () => {
      parar();
      app.remove();
      rede();
      clearInterval(timer);
    };
  }, [kick]);

  const enqueueAndSend = useCallback<QueueState["enqueueAndSend"]>(
    async (jpeg, folder, uploadId) => {
      await queue.enqueue(jpeg, folder, uploadId);
      return kick(true);
    },
    [kick],
  );

  const retry = useCallback<QueueState["retry"]>(async (uploadId, folder) => {
    await queue.retry(uploadId, folder);
    await kick(true);
  }, [kick]);

  const discard = useCallback<QueueState["discard"]>((uploadId) => queue.discard(uploadId), []);

  return <Ctx.Provider value={{ items, kick, enqueueAndSend, retry, discard }}>{children}</Ctx.Provider>;
}

export function useQueue(): QueueState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useQueue fora do QueueProvider");
  return v;
}
