/**
 * Pareamento: lê o QR do PC com a câmera, gera a chave, mostra o código de 6 dígitos
 * e espera você confirmar no PC.
 *
 * Segurança: o pareamento só começa pelo leitor desta tela. A rota não aceita
 * parâmetros de link (um link malicioso não consegue parear com o PC de outra pessoa).
 */
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import * as Device from "expo-device";
import { router } from "expo-router";
import { useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from "react-native";
import { parsePairUri, type PairInfo } from "@shotfolder/protocol";
import { ApiError, pairWithPc, safeDeviceName } from "../lib/api";
import { pairCodeFor } from "../lib/crypto";
import { usePaired } from "../lib/paired-context";
import type { KeystoreSigner } from "../lib/keystore-signer";
import { newSigner, savePaired } from "../lib/storage";
import { Botao, cores } from "../lib/ui";

type Etapa =
  | { tipo: "lendo" }
  | { tipo: "esperando"; codigo: string; host: string }
  | { tipo: "erro"; mensagem: string };

export default function Parear() {
  const [permissao, pedirPermissao] = useCameraPermissions();
  const [etapa, setEtapa] = useState<Etapa>({ tipo: "lendo" });
  const [nome, setNome] = useState(() => safeDeviceName(Device.modelName));
  const [textoManual, setTextoManual] = useState("");
  const ocupado = useRef(false);
  const { reload } = usePaired();

  async function iniciar(info: PairInfo) {
    let signer: KeystoreSigner | null = null;
    try {
      // A chave nasce dentro do Keystore; daqui só sai a parte pública.
      signer = await newSigner();
      setEtapa({ tipo: "esperando", codigo: pairCodeFor(info.token, signer.publicKeySpki), host: info.host });
      const deviceName = safeDeviceName(nome);
      const session = await pairWithPc(info, signer, deviceName);
      await savePaired(session, signer, deviceName);
      await reload();
      router.back();
    } catch (e) {
      signer?.destroy(); // pareamento não deu certo: a chave nova não serve para nada
      setEtapa({
        tipo: "erro",
        mensagem: e instanceof ApiError ? e.message : signer ? "Erro inesperado no pareamento." : "Não consegui criar a chave no Keystore.",
      });
    } finally {
      ocupado.current = false;
    }
  }

  function aoLer(texto: string) {
    if (ocupado.current) return; // a câmera dispara várias leituras seguidas
    const info = parsePairUri(texto);
    if (!info) {
      setEtapa({ tipo: "erro", mensagem: "Isso não é um QR do ShotFolder." });
      return;
    }
    ocupado.current = true;
    void iniciar(info);
  }

  if (etapa.tipo === "esperando") {
    return (
      <View style={[s.tela, s.centro]}>
        <Text style={s.rotulo}>Código de confirmação</Text>
        <Text style={s.codigoGrande}>{etapa.codigo}</Text>
        <Text style={[s.texto, { textAlign: "center" }]}>
          Confira se o PC mostra exatamente este código e responda "s" lá.
        </Text>
        <ActivityIndicator style={{ marginTop: 16 }} />
        <Text style={s.suave}>Esperando o PC ({etapa.host})…</Text>
      </View>
    );
  }

  if (etapa.tipo === "erro") {
    return (
      <View style={s.tela}>
        <Text style={s.erro}>{etapa.mensagem}</Text>
        <Botao onPress={() => setEtapa({ tipo: "lendo" })}>Tentar de novo</Botao>
      </View>
    );
  }

  return (
    <View style={s.tela}>
      <Text style={s.rotulo}>Nome deste celular no PC</Text>
      <TextInput style={s.entrada} value={nome} onChangeText={setNome} maxLength={40} />

      {!permissao ? (
        <ActivityIndicator />
      ) : !permissao.granted ? (
        <View style={{ gap: 10 }}>
          <Text style={s.texto}>O ShotFolder precisa da câmera para ler o QR.</Text>
          <Botao onPress={() => void pedirPermissao()}>Permitir câmera</Botao>
        </View>
      ) : (
        <View style={s.camera}>
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={(r: BarcodeScanningResult) => aoLer(r.data)}
          />
        </View>
      )}

      <Text style={s.suave}>Sem câmera? Cole o "Texto do QR" mostrado no PC:</Text>
      <TextInput
        style={s.entrada}
        value={textoManual}
        onChangeText={setTextoManual}
        placeholder="shotfolder://pair?..."
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Botao tipo="secundario" onPress={() => aoLer(textoManual)} desativado={textoManual.length === 0}>
        Usar texto colado
      </Botao>
    </View>
  );
}

const s = StyleSheet.create({
  tela: { flex: 1, padding: 20, gap: 12 },
  centro: { alignItems: "center", justifyContent: "center" },
  texto: { fontSize: 16, color: cores.texto },
  suave: { fontSize: 13, color: cores.suave },
  rotulo: { fontSize: 13, fontWeight: "700", color: cores.suave, textTransform: "uppercase" },
  erro: { color: cores.perigo, fontSize: 16 },
  codigoGrande: { fontSize: 44, fontWeight: "800", letterSpacing: 6, color: cores.texto, fontFamily: "monospace" },
  camera: { height: 280, borderRadius: 12, overflow: "hidden", backgroundColor: "#000" },
  entrada: {
    backgroundColor: cores.cartao,
    borderWidth: 1,
    borderColor: cores.borda,
    borderRadius: 10,
    padding: 12,
    fontSize: 15,
    color: cores.texto,
  },
});
