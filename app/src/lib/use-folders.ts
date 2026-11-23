/**
 * Lista de pastas para escolher (tela de foto e tela de compartilhar).
 * Busca no PC; sem conexão, usa a última lista guardada no celular.
 * Sugestão: última pasta usada → padrão do PC → primeira.
 */
import { randomUUID } from "expo-crypto";
import { useEffect, useState } from "react";
import { ApiError, listFolders, type Folder } from "./api";
import { usePaired } from "./paired-context";
import { loadFolderCache, loadLastFolder, saveFolderCache } from "./storage";

export interface FoldersState {
  pastas: Folder[];
  pasta: string | null;
  setPasta: (id: string) => void;
  /** Aviso para mostrar (ex.: "sem conexão, usando a lista de ontem"). */
  aviso: string | null;
  nomeDa: (id: string) => string;
}

export function useFolders(): FoldersState {
  const { paired } = usePaired();
  const [pastas, setPastas] = useState<Folder[]>([]);
  const [pasta, setPasta] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => {
    if (!paired) return;
    let vivo = true;
    (async () => {
      let lista: { folders: Folder[]; defaultFolder: string | null } | null = null;
      try {
        lista = await listFolders(paired.session, paired.signer, { now: Date.now, uuid: randomUUID });
        await saveFolderCache({ ...lista, at: Date.now() });
        if (vivo) setAviso(null);
      } catch (e) {
        const cache = await loadFolderCache();
        if (cache) {
          lista = cache;
          const quando = new Date(cache.at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
          if (vivo) setAviso(`Sem conexão com o PC: usando a lista de pastas de ${quando}. A foto vai para a fila.`);
        } else if (vivo) {
          setAviso(e instanceof ApiError ? e.message : "Não consegui carregar as pastas.");
        }
      }
      if (!lista || !vivo) return;
      const ultima = await loadLastFolder();
      const ids = lista.folders.map((f) => f.id);
      setPastas(lista.folders);
      setPasta(
        ultima && ids.includes(ultima)
          ? ultima
          : lista.defaultFolder && ids.includes(lista.defaultFolder)
            ? lista.defaultFolder
            : (ids[0] ?? null),
      );
    })();
    return () => {
      vivo = false;
    };
  }, [paired]);

  return { pastas, pasta, setPasta, aviso, nomeDa: (id) => pastas.find((p) => p.id === id)?.name ?? id };
}
