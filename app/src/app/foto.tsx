/**
 * Tirar foto → revisar → escolher a pasta → enviar (pela fila).
 *
 * Tudo nesta tela, sem parâmetros de rota: um link externo não consegue mandar
 * um arquivo qualquer do celular para o PC.
 */
import { CameraView, useCameraPermissions } from "expo-camera";
import { randomUUID } from "expo-crypto";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { UploadResult } from "../lib/api";
import { FolderPicker } from "../lib/folder-picker";
import { usePaired } from "../lib/paired-context";
import { discardPhoto, preparePhoto, type PreparedPhoto } from "../lib/photo";
import { useQueue } from "../lib/queue-context";
import { saveLastFolder } from "../lib/storage";
import { Botao, cores } from "../lib/ui";
import { useFolders } from "../lib/use-folders";

type Fase =
  | { tipo: "camera" }
  | { tipo: "processando" }
  | { tipo: "revisao"; foto: PreparedPhoto }
  | { tipo: "enviando" }
  | { tipo: "pronto"; resultado: UploadResult; pasta: string }
  | { tipo: "na_fila"; motivo: string; falhou: boolean }
  | { tipo: "erro"; mensagem: string };

const kb = (n: number) => `${Math.round(n / 1024)} KB`;

export default function Foto() {
  const { paired } = usePaired();
  const { enqueueAndSend, items } = useQueue();
  const pastas = useFolders();
  const [permissao, pedirPermissao] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [cameraPronta, setCameraPronta] = useState(false);
  const [fase, setFase] = useState<Fase>({ tipo: "camera" });
  /** Um id por foto: é ele que impede duplicar no PC em qualquer reenvio. */
  const uploadId = useRef<string>(randomUUID());

  // Ao sair da tela sem enviar, apaga a foto temporária.
  const fotoRef = useRef<PreparedPhoto | null>(null);
  fotoRef.current = fase.tipo === "revisao" ? fase.foto : null;
  useEffect(() => () => discardPhoto(fotoRef.current), []);

  if (!paired) {
    return (
      <View style={s.tela}>
        <Text style={s.texto}>Pareie o celular com o PC primeiro.</Text>
        <Botao onPress={() => router.replace("/")}>Voltar</Botao>
      </View>
    );
  }

  async function tirar() {
    if (!camera.current || !cameraPronta) return;
    setFase({ tipo: "processando" });
    try {
      const foto = await camera.current.takePictureAsync({ quality: 1, exif: false, shutterSound: true });
      const pronta = await preparePhoto(foto.uri);
      uploadId.current = randomUUID();
      setFase({ tipo: "revisao", foto: pronta });
    } catch {
      setFase({ tipo: "erro", mensagem: "Não consegui tirar ou preparar a foto." });
    }
  }

  async function enviar(foto: PreparedPhoto) {
    const pasta = pastas.pasta;
    if (!pasta) return;
    const id = uploadId.current;
    setFase({ tipo: "enviando" });
    try {
      const resumo = await enqueueAndSend(foto.bytes, { id: pasta, name: pastas.nomeDa(pasta) }, id);
      await saveLastFolder(pasta);
      discardPhoto(foto); // os bytes já estão guardados na fila
      const enviada = resumo?.enviadas.find((e) => e.item.uploadId === id);
      if (enviada) {
        setFase({ tipo: "pronto", resultado: enviada.result, pasta: pastas.nomeDa(pasta) });
        return;
      }
      const falha = resumo?.falhas.find((i) => i.uploadId === id);
      setFase({
        tipo: "na_fila",
        falhou: Boolean(falha),
        motivo: falha?.lastError ?? "Será enviada sozinha quando o PC estiver acessível.",
      });
    } catch {
      setFase({ tipo: "erro", mensagem: "Não consegui guardar a foto no celular." });
    }
  }

  function descartar(foto: PreparedPhoto | null) {
    discardPhoto(foto);
    setFase({ tipo: "camera" });
  }

  // ---------- telas ----------

  if (fase.tipo === "processando" || fase.tipo === "enviando") {
    return (
      <View style={[s.tela, s.centro]}>
        <ActivityIndicator size="large" />
        <Text style={s.texto}>{fase.tipo === "processando" ? "Preparando a foto…" : "Enviando para o PC…"}</Text>
      </View>
    );
  }

  if (fase.tipo === "pronto" || fase.tipo === "na_fila") {
    const pendentes = items.filter((i) => i.status === "pendente").length;
    return (
      <View style={[s.tela, s.centro]}>
        {fase.tipo === "pronto" ? (
          <>
            <Text style={s.titulo}>{fase.resultado.status === "saved" ? "Foto enviada" : "O PC já tinha esta foto"}</Text>
            <Text style={s.texto}>{fase.resultado.file}</Text>
            <Text style={s.suave}>em {fase.pasta}</Text>
          </>
        ) : (
          <>
            <Text style={s.titulo}>{fase.falhou ? "Não deu para enviar" : "Foto na fila"}</Text>
            <Text style={[s.texto, { textAlign: "center" }]}>{fase.motivo}</Text>
            <Text style={s.suave}>
              {fase.falhou ? "Ela ficou na fila da tela inicial para tentar de novo ou descartar." : `${pendentes} foto(s) esperando envio.`}
            </Text>
          </>
        )}
        <Botao onPress={() => setFase({ tipo: "camera" })} style={{ alignSelf: "stretch", marginTop: 16 }}>
          Outra foto
        </Botao>
        <Botao tipo="secundario" onPress={() => router.back()} style={{ alignSelf: "stretch" }}>
          Voltar ao início
        </Botao>
      </View>
    );
  }

  if (fase.tipo === "erro") {
    return (
      <View style={s.tela}>
        <Text style={s.erro}>{fase.mensagem}</Text>
        <Botao tipo="secundario" onPress={() => setFase({ tipo: "camera" })}>
          Voltar à câmera
        </Botao>
      </View>
    );
  }

  if (fase.tipo === "revisao") {
    const foto = fase.foto;
    return (
      <ScrollView contentContainerStyle={s.tela}>
        <Image source={{ uri: foto.uri }} style={[s.previa, { aspectRatio: foto.width / foto.height }]} resizeMode="contain" />
        <Text style={s.suave}>
          {foto.width}×{foto.height} · {kb(foto.bytes.length)} · sem localização
        </Text>
        <FolderPicker f={pastas} />
        <Botao onPress={() => void enviar(foto)} desativado={!pastas.pasta}>
          Enviar
        </Botao>
        <Botao tipo="secundario" onPress={() => descartar(foto)}>
          Descartar
        </Botao>
      </ScrollView>
    );
  }

  // fase "camera"
  if (!permissao) return <ActivityIndicator style={{ marginTop: 40 }} />;
  if (!permissao.granted) {
    return (
      <View style={s.tela}>
        <Text style={s.texto}>O ShotFolder precisa da câmera para tirar a foto.</Text>
        <Botao onPress={() => void pedirPermissao()}>Permitir câmera</Botao>
      </View>
    );
  }
  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <CameraView ref={camera} style={{ flex: 1 }} facing="back" onCameraReady={() => setCameraPronta(true)} />
      <View style={s.barra}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Tirar foto"
          onPress={() => void tirar()}
          disabled={!cameraPronta}
          style={({ pressed }) => [s.disparador, (pressed || !cameraPronta) && { opacity: 0.6 }]}
        />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  tela: { flexGrow: 1, padding: 20, gap: 12 },
  centro: { flex: 1, alignItems: "center", justifyContent: "center" },
  titulo: { fontSize: 22, fontWeight: "700", color: cores.texto },
  texto: { fontSize: 16, color: cores.texto },
  suave: { fontSize: 13, color: cores.suave },
  erro: { color: cores.perigo, fontSize: 16 },
  previa: { width: "100%", borderRadius: 12, backgroundColor: "#000" },
  barra: { position: "absolute", bottom: 40, left: 0, right: 0, alignItems: "center" },
  disparador: { width: 76, height: 76, borderRadius: 38, backgroundColor: "#FFFFFF", borderWidth: 5, borderColor: "rgba(255,255,255,0.5)" },
});
