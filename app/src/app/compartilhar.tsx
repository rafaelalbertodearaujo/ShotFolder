/**
 * Fotos recebidas pelo "Compartilhar" da Galeria (ou de outro app).
 * Mostra as fotos, você escolhe a pasta e confirma. Cada uma vira JPEG ≤2048 px,
 * sem EXIF, e vai para a fila. O arquivo original na Galeria não é alterado.
 *
 * Segurança: esta tela não lê nada da URL. Os arquivos vêm só do sistema
 * (expo-share-intent), e nada sai sem você tocar em "Enviar".
 */
import { randomUUID } from "expo-crypto";
import { router } from "expo-router";
import { useShareIntentContext } from "expo-share-intent";
import { useState } from "react";
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, View } from "react-native";
import { FolderPicker } from "../lib/folder-picker";
import { usePaired } from "../lib/paired-context";
import { discardPhoto, preparePhoto } from "../lib/photo";
import { useQueue } from "../lib/queue-context";
import { MAX_COMPARTILHADAS, selecionarImagens } from "../lib/share";
import { saveLastFolder } from "../lib/storage";
import { Botao, cores } from "../lib/ui";
import { useFolders } from "../lib/use-folders";

type Fase =
  | { tipo: "escolha" }
  | { tipo: "enviando"; feitas: number; total: number }
  | { tipo: "fim"; enviadas: number; naFila: number; falhas: number };

export default function Compartilhar() {
  const { paired } = usePaired();
  const { shareIntent, resetShareIntent } = useShareIntentContext();
  const { enqueueAndSend } = useQueue();
  const pastas = useFolders();
  const [fase, setFase] = useState<Fase>({ tipo: "escolha" });

  const sel = selecionarImagens(shareIntent.files);

  const sair = () => {
    resetShareIntent();
    router.replace("/");
  };

  if (!paired) {
    return (
      <View style={s.tela}>
        <Text style={s.texto}>Pareie o celular com o PC antes de compartilhar fotos.</Text>
        <Botao onPress={sair}>Voltar</Botao>
      </View>
    );
  }

  async function enviar() {
    const pasta = pastas.pasta;
    if (!pasta) return;
    const folder = { id: pasta, name: pastas.nomeDa(pasta) };
    let enviadas = 0;
    let naFila = 0;
    let falhas = 0;
    for (let i = 0; i < sel.aceitas.length; i++) {
      setFase({ tipo: "enviando", feitas: i, total: sel.aceitas.length });
      const arquivo = sel.aceitas[i]!;
      try {
        // Converte (HEIC → JPEG), reduz e tira o EXIF. O original da Galeria fica intacto.
        const foto = await preparePhoto(arquivo.path, false);
        const id = randomUUID();
        const resumo = await enqueueAndSend(foto.bytes, folder, id);
        discardPhoto(foto);
        if (resumo?.enviadas.some((e) => e.item.uploadId === id)) enviadas++;
        else naFila++;
      } catch {
        falhas++;
      }
    }
    await saveLastFolder(pasta);
    resetShareIntent();
    setFase({ tipo: "fim", enviadas, naFila, falhas });
  }

  if (fase.tipo === "enviando") {
    return (
      <View style={[s.tela, s.centro]}>
        <ActivityIndicator size="large" />
        <Text style={s.texto}>
          Preparando e enviando {fase.feitas + 1} de {fase.total}…
        </Text>
      </View>
    );
  }

  if (fase.tipo === "fim") {
    return (
      <View style={[s.tela, s.centro]}>
        <Text style={s.titulo}>Pronto</Text>
        {fase.enviadas > 0 && <Text style={s.texto}>{fase.enviadas} enviada(s) para o PC.</Text>}
        {fase.naFila > 0 && <Text style={s.texto}>{fase.naFila} na fila (vão sozinhas quando o PC estiver acessível).</Text>}
        {fase.falhas > 0 && <Text style={s.erro}>{fase.falhas} não puderam ser abertas.</Text>}
        <Botao onPress={() => router.replace("/")} style={{ alignSelf: "stretch", marginTop: 16 }}>
          Ir para o início
        </Botao>
      </View>
    );
  }

  if (sel.aceitas.length === 0) {
    return (
      <View style={s.tela}>
        <Text style={s.texto}>O ShotFolder só recebe fotos (JPEG, PNG, WEBP ou HEIC).</Text>
        <Botao onPress={sair}>Voltar</Botao>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={s.tela}>
      <Text style={s.titulo}>
        {sel.aceitas.length === 1 ? "1 foto para o PC" : `${sel.aceitas.length} fotos para o PC`}
      </Text>
      <View style={s.grade}>
        {sel.aceitas.map((f) => (
          <Image key={f.path} source={{ uri: f.path }} style={s.miniatura} resizeMode="cover" />
        ))}
      </View>
      {sel.excedentes > 0 && (
        <Text style={s.suave}>
          Só as {MAX_COMPARTILHADAS} primeiras vão agora; {sel.excedentes} ficaram de fora.
        </Text>
      )}
      {sel.ignoradas > 0 && <Text style={s.suave}>{sel.ignoradas} arquivo(s) que não são foto foram ignorados.</Text>}
      <Text style={s.suave}>Vão como JPEG reduzido e sem localização. O original na Galeria não muda.</Text>

      <FolderPicker f={pastas} />

      <Botao onPress={() => void enviar()} desativado={!pastas.pasta}>
        Enviar
      </Botao>
      <Botao tipo="secundario" onPress={sair}>
        Cancelar
      </Botao>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  tela: { flexGrow: 1, padding: 20, gap: 12 },
  centro: { flex: 1, alignItems: "center", justifyContent: "center" },
  titulo: { fontSize: 22, fontWeight: "700", color: cores.texto },
  texto: { fontSize: 16, color: cores.texto },
  suave: { fontSize: 13, color: cores.suave },
  erro: { color: cores.perigo, fontSize: 16 },
  grade: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  miniatura: { width: 100, height: 100, borderRadius: 8, backgroundColor: "#ddd" },
});
