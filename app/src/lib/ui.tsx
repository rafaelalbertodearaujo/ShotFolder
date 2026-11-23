/** Peças visuais simples e reaproveitadas. */
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from "react-native";

export const cores = {
  fundo: "#F6F7F9",
  texto: "#14171C",
  suave: "#5B6470",
  primaria: "#1F5EFF",
  perigo: "#C62828",
  ok: "#1B7F3B",
  borda: "#DDE1E6",
  cartao: "#FFFFFF",
};

export function Botao(props: {
  children: ReactNode;
  onPress: () => void;
  tipo?: "primario" | "secundario" | "perigo";
  desativado?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const tipo = props.tipo ?? "primario";
  return (
    <Pressable
      accessibilityRole="button"
      disabled={props.desativado}
      onPress={props.onPress}
      style={({ pressed }) => [
        s.botao,
        tipo === "primario" && { backgroundColor: cores.primaria },
        tipo === "secundario" && { backgroundColor: cores.cartao, borderWidth: 1, borderColor: cores.borda },
        tipo === "perigo" && { backgroundColor: cores.cartao, borderWidth: 1, borderColor: cores.perigo },
        (pressed || props.desativado) && { opacity: 0.6 },
        props.style,
      ]}
    >
      <Text
        style={[
          s.botaoTexto,
          tipo === "secundario" && { color: cores.texto },
          tipo === "perigo" && { color: cores.perigo },
        ]}
      >
        {props.children}
      </Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  botao: { paddingVertical: 14, paddingHorizontal: 18, borderRadius: 10, alignItems: "center" },
  botaoTexto: { color: "#FFFFFF", fontSize: 16, fontWeight: "600" },
});
