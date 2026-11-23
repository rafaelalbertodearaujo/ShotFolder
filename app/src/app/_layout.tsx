import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { PairedProvider } from "../lib/paired-context";
import { cores } from "../lib/ui";

export default function Layout() {
  return (
    <PairedProvider>
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
      </Stack>
    </PairedProvider>
  );
}
