import { router, Stack } from "expo-router";
import { ShareIntentProvider, useShareIntentContext } from "expo-share-intent";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { PairedProvider } from "../lib/paired-context";
import { QueueProvider } from "../lib/queue-context";
// Carregar aqui garante que a tarefa de segundo plano esteja definida assim que o app inicia.
import "../lib/queue-runtime";
import { cores } from "../lib/ui";

/** Quando chega algo pelo "Compartilhar", abre a tela de confirmação. */
function AoCompartilhar() {
  const { hasShareIntent } = useShareIntentContext();
  useEffect(() => {
    if (hasShareIntent) router.push("/compartilhar");
  }, [hasShareIntent]);
  return null;
}

export default function Layout() {
  return (
    // O provedor do "Compartilhar" precisa ficar por fora de todos os outros.
    <ShareIntentProvider>
      <PairedProvider>
        <QueueProvider>
          <StatusBar style="dark" />
          <AoCompartilhar />
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: cores.fundo },
              headerTintColor: cores.texto,
              contentStyle: { backgroundColor: cores.fundo },
            }}
          >
            <Stack.Screen name="index" options={{ title: "ShotFolder" }} />
            <Stack.Screen name="parear" options={{ title: "Parear com o PC" }} />
            <Stack.Screen name="foto" options={{ title: "Foto" }} />
            <Stack.Screen name="compartilhar" options={{ title: "Enviar ao PC" }} />
          </Stack>
        </QueueProvider>
      </PairedProvider>
    </ShareIntentProvider>
  );
}
