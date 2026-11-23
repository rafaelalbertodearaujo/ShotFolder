/**
 * Estado global simples: o celular está pareado? Carrega do SecureStore ao abrir.
 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { forgetPaired, loadPaired, type Paired } from "./storage";

interface PairedState {
  loading: boolean;
  paired: Paired | null;
  reload: () => Promise<void>;
  forget: () => Promise<void>;
}

const Ctx = createContext<PairedState | null>(null);

export function PairedProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [paired, setPaired] = useState<Paired | null>(null);

  const reload = useCallback(async () => {
    setPaired(await loadPaired());
    setLoading(false);
  }, []);

  const forget = useCallback(async () => {
    await forgetPaired();
    setPaired(null);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return <Ctx.Provider value={{ loading, paired, reload, forget }}>{children}</Ctx.Provider>;
}

export function usePaired(): PairedState {
  const v = useContext(Ctx);
  if (!v) throw new Error("usePaired fora do PairedProvider");
  return v;
}
