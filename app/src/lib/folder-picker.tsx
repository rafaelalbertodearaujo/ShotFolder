/** Botões de escolha de pasta (usados na foto e no compartilhar). */
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { FoldersState } from "./use-folders";
import { cores } from "./ui";

export function FolderPicker({ f }: { f: FoldersState }) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={s.rotulo}>Pasta no PC</Text>
      {f.aviso && <Text style={s.aviso}>{f.aviso}</Text>}
      <View style={s.chips}>
        {f.pastas.map((p) => (
          <Pressable
            key={p.id}
            onPress={() => f.setPasta(p.id)}
            accessibilityRole="radio"
            accessibilityState={{ selected: f.pasta === p.id }}
            style={[s.chip, f.pasta === p.id && s.chipAtivo]}
          >
            <Text style={[s.chipTexto, f.pasta === p.id && { color: "#FFFFFF" }]}>{p.name}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  rotulo: { fontSize: 13, fontWeight: "700", color: cores.suave, textTransform: "uppercase", marginTop: 6 },
  aviso: { fontSize: 14, color: "#8A5300" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, borderColor: cores.borda, backgroundColor: cores.cartao },
  chipAtivo: { backgroundColor: cores.primaria, borderColor: cores.primaria },
  chipTexto: { fontSize: 15, color: cores.texto },
});
