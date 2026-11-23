import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { PairedProvider } from "../lib/paired-context";
import { QueueProvider } from "../lib/queue-context";
// Carregar aqui garante que a tarefa de segundo plano esteja definida assim que o app inicia.
import "../lib/queue-runtime";
import { cores } from "../lib/ui";

export default function Layout() {
  return (
    <PairedProvider>
      <QueueProvider>
        <StatusBar style="dark" />
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
        </Stack>
      </QueueProvider>
    </PairedProvider>
  );
}
