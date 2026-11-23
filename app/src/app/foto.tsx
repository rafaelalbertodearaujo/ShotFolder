/**
 * Tirar foto → revisar → escolher a pasta → enviar.
 *
 * Tudo nesta tela, sem parâmetros de rota: um link externo não consegue mandar
 * um arquivo qualquer do celular para o PC.
 */
import { CameraView, useCameraPermissions } from "expo-camera";
import { randomUUID } from "expo-crypto";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ApiError, listFolders, uploadPhoto, type Folder, type UploadResult } from "../lib/api";
import { usePaired } from "../lib/paired-context";
import { discardPhoto, preparePhoto, type PreparedPhoto } from "../lib/photo";
import { loadLastFolder, saveLastFolder } from "../lib/storage";
import { Botao, cores } from "../lib/ui";

type Fase =
  | { tipo: "camera" }
  | { tipo: "processando" }
  | { tipo: "revisao"; foto: PreparedPhoto }
  | { tipo: "enviando"; foto: PreparedPhoto }
  | { tipo: "pronto"; resultado: UploadResult; pasta: string }
  | { tipo: "erro"; mensagem: string; foto: PreparedPhoto | null };

const kb = (n: number) => `${Math.round(n / 1024)} KB`;

export default function Foto() {
  const { paired } = usePaired();
  const [permissao, pedirPermissao] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [cameraPronta, setCameraPronta] = useState(false);
  const [fase, setFase] = useState<Fase>({ tipo: "camera" });
  const [pastas, setPastas] = useState<Folder[]>([]);
  const [pasta, setPasta] = useState<string | null>(null);
  const [erroPastas, setErroPastas] = useState<string | null>(null);
  /** Mesmo id em todas as tentativas da mesma foto: reenviar não duplica no PC. */
  const uploadId = useRef<string>(randomUUID());

  // Carrega as pastas e escolhe: última usada → padrão do PC → primeira.
  useEffect(() => {
    if (!paired) return;
    let vivo = true;
    (async () => {
      try {
        const lista = await listFolders(paired.session, paired.signer, { now: Date.now, uuid: randomUUID });
        const ultima = await loadLastFolder();
        if (!vivo) return;
        setPastas(lista.folders);
        const ids = lista.folders.map((f) => f.id);
        setPasta(
          ultima && ids.includes(ultima) ? ultima : lista.defaultFolder && ids.includes(lista.defaultFolder) ? lista.defaultFolder : (ids[0] ?? null),
        );
      } catch (e) {
        if (vivo) setErroPastas(e instanceof ApiError ? e.message : "Não consegui carregar as pastas.");
      }
    })();
    return () => {
      vivo = false;
    };
  }, [paired]);

  // Ao sair da tela, apaga a foto temporária que ainda estiver na memória.
  const fotoAtual = fase.tipo === "revisao" || fase.tipo === "enviando" ? fase.foto : fase.tipo === "erro" ? fase.foto : null;
  const fotoRef = useRef<PreparedPhoto | null>(null);
  fotoRef.current = fotoAtual;
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
      setFase({ tipo: "erro", mensagem: "Não consegui tirar ou preparar a foto.", foto: null });
    }
  }

  async function enviar(foto: PreparedPhoto) {
    if (!paired || !pasta) return;
    setFase({ tipo: "enviando", foto });
    try {
      const resultado = await uploadPhoto(paired.session, paired.signer, pasta, foto.bytes, {
        now: Date.now,
        uuid: randomUUID,
      }, { uploadId: uploadId.current });
      await saveLastFolder(pasta);
      discardPhoto(foto);
      setFase({ tipo: "pronto", resultado, pasta: pastas.find((p) => p.id === pasta)?.name ?? pasta });
    } catch (e) {
      // Mantém a foto para tentar de novo (a fila automática vem na etapa 7).
      setFase({ tipo: "erro", mensagem: e instanceof ApiError ? e.message : "Erro inesperado no envio.", foto });
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

  if (fase.tipo === "pronto") {
    return (
      <View style={[s.tela, s.centro]}>
        <Text style={s.titulo}>{fase.resultado.status === "saved" ? "Foto enviada" : "O PC já tinha esta foto"}</Text>
        <Text style={s.texto}>{fase.resultado.file}</Text>
        <Text style={s.suave}>em {fase.pasta}</Text>
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
    const foto = fase.foto;
    return (
      <View style={s.tela}>
        <Text style={s.erro}>{fase.mensagem}</Text>
        {foto && <Botao onPress={() => void enviar(foto)}>Tentar enviar de novo</Botao>}
        <Botao tipo="secundario" onPress={() => descartar(foto)}>
          {foto ? "Descartar e tirar outra" : "Voltar à câmera"}
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

        <Text style={s.rotulo}>Pasta no PC</Text>
        {erroPastas && <Text style={s.erro}>{erroPastas}</Text>}
        <View style={s.chips}>
          {pastas.map((p) => (
            <Pressable
              key={p.id}
              onPress={() => setPasta(p.id)}
              accessibilityRole="radio"
              accessibilityState={{ selected: pasta === p.id }}
              style={[s.chip, pasta === p.id && s.chipAtivo]}
            >
              <Text style={[s.chipTexto, pasta === p.id && { color: "#FFFFFF" }]}>{p.name}</Text>
            </Pressable>
          ))}
        </View>

        <Botao onPress={() => void enviar(foto)} desativado={!pasta}>
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
  rotulo: { fontSize: 13, fontWeight: "700", color: cores.suave, textTransform: "uppercase", marginTop: 6 },
  erro: { color: cores.perigo, fontSize: 16 },
  previa: { width: "100%", borderRadius: 12, backgroundColor: "#000" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, borderColor: cores.borda, backgroundColor: cores.cartao },
  chipAtivo: { backgroundColor: cores.primaria, borderColor: cores.primaria },
  chipTexto: { fontSize: 15, color: cores.texto },
  barra: { position: "absolute", bottom: 40, left: 0, right: 0, alignItems: "center" },
  disparador: { width: 76, height: 76, borderRadius: 38, backgroundColor: "#FFFFFF", borderWidth: 5, borderColor: "rgba(255,255,255,0.5)" },
});
