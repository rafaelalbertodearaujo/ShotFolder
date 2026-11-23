/**
 * Tela inicial: pareamento, botão de foto, fila de envio e pastas do PC.
 */
import { randomUUID } from "expo-crypto";
import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { ApiError, listFolders, type FolderList } from "../lib/api";
import { securityLevelLabel } from "../lib/keystore-signer";
import { usePaired } from "../lib/paired-context";
import type { QueueItem } from "../lib/queue";
import { useQueue } from "../lib/queue-context";
import { saveFolderCache } from "../lib/storage";
import { Botao, cores } from "../lib/ui";

const hora = (ms: number) => new Date(ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

export default function Inicio() {
  const { loading, paired, forget } = usePaired();
  const fila = useQueue();
  const [lista, setLista] = useState<FolderList | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  const atualizar = useCallback(async () => {
    if (!paired) return;
    setCarregando(true);
    setErro(null);
    try {
      const l = await listFolders(paired.session, paired.signer, { now: Date.now, uuid: randomUUID });
      setLista(l);
      await saveFolderCache({ ...l, at: Date.now() });
      void fila.kick(true); // o PC respondeu: aproveita para esvaziar a fila
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Erro inesperado ao listar as pastas.");
    } finally {
      setCarregando(false);
    }
  }, [paired, fila.kick]);

  useEffect(() => {
    setLista(null);
    void atualizar();
  }, [atualizar]);

  if (loading) {
    return (
      <View style={s.centro}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!paired) {
    return (
      <View style={s.tela}>
        <Text style={s.titulo}>Este celular ainda não está pareado.</Text>
        <Text style={s.texto}>
          No PC, rode <Text style={s.codigo}>shotfolder pair</Text> e leia o QR que aparecer.
        </Text>
        <Botao onPress={() => router.push("/parear")}>Ler QR do PC</Botao>
      </View>
    );
  }

  const esquecer = () =>
    Alert.alert(
      "Esquecer o pareamento?",
      "Apaga a chave deste celular. Para cortar o acesso de vez, revogue também no PC (shotfolder devices revoke).",
      [
        { text: "Cancelar", style: "cancel" },
        { text: "Esquecer", style: "destructive", onPress: () => void forget() },
      ],
    );

  const descartar = (i: QueueItem) =>
    Alert.alert("Descartar esta foto?", "Ela sai da fila e é apagada do celular. Não vai para o PC.", [
      { text: "Cancelar", style: "cancel" },
      { text: "Descartar", style: "destructive", onPress: () => void fila.discard(i.uploadId) },
    ]);

  const pendentes = fila.items.filter((i) => i.status === "pendente");

  return (
    <ScrollView
      contentContainerStyle={s.tela}
      refreshControl={<RefreshControl refreshing={carregando} onRefresh={() => void atualizar()} />}
    >
      <View style={s.cartao}>
        <Text style={s.rotulo}>Pareado com o PC</Text>
        <Text style={s.texto}>
          {paired.session.host}:{paired.session.port}
        </Text>
        <Text style={s.suave}>
          {paired.deviceName} · {paired.session.deviceId}
        </Text>
        <Text style={s.suave}>Chave guardada no {securityLevelLabel(paired.signer.securityLevel)}</Text>
      </View>

      <Botao onPress={() => router.push("/foto")}>Tirar foto</Botao>

      {fila.items.length > 0 && (
        <View style={{ gap: 8 }}>
          <Text style={s.rotulo}>Fila de envio ({fila.items.length})</Text>
          {fila.items.map((i) => (
            <View key={i.uploadId} style={s.item}>
              <Text style={s.texto}>
                {i.folderName} · {hora(i.createdAt)}
              </Text>
              {i.status === "falhou" ? (
                <Text style={s.erro}>{i.lastError ?? "Falhou."}</Text>
              ) : (
                <Text style={s.suave}>
                  {i.attempts === 0
                    ? "Esperando envio"
                    : `Tentativa ${i.attempts} falhou (${i.lastError ?? "erro"}). Próxima às ${hora(i.nextAttemptAt)}.`}
                </Text>
              )}
              <View style={s.linha}>
                <Botao tipo="secundario" onPress={() => void fila.retry(i.uploadId)} style={s.botaoPequeno}>
                  Tentar agora
                </Botao>
                <Botao tipo="perigo" onPress={() => descartar(i)} style={s.botaoPequeno}>
                  Descartar
                </Botao>
              </View>
            </View>
          ))}
          {pendentes.length > 1 && (
            <Botao tipo="secundario" onPress={() => void fila.kick(true)}>
              Enviar todas agora
            </Botao>
          )}
        </View>
      )}

      <Text style={s.rotulo}>Pastas do PC</Text>
      {erro && <Text style={s.erro}>{erro}</Text>}
      {(lista?.folders ?? []).map((item) => (
        <View key={item.id} style={s.item}>
          <Text style={s.texto}>{item.name}</Text>
          <Text style={s.suave}>
            {item.id}
            {item.id === lista?.defaultFolder ? " · padrão" : ""}
          </Text>
        </View>
      ))}
      {lista && lista.folders.length === 0 && <Text style={s.suave}>Nenhuma pasta. No PC: shotfolder folders add …</Text>}
      <Botao tipo="secundario" onPress={() => void atualizar()} desativado={carregando}>
        Atualizar pastas
      </Botao>
      <Botao tipo="perigo" onPress={esquecer} style={{ marginTop: 24 }}>
        Esquecer pareamento
      </Botao>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  tela: { flexGrow: 1, padding: 20, gap: 14 },
  centro: { flex: 1, alignItems: "center", justifyContent: "center" },
  titulo: { fontSize: 20, fontWeight: "700", color: cores.texto },
  texto: { fontSize: 16, color: cores.texto },
  suave: { fontSize: 13, color: cores.suave },
  rotulo: { fontSize: 13, fontWeight: "700", color: cores.suave, textTransform: "uppercase" },
  codigo: { fontFamily: "monospace", fontWeight: "600" },
  erro: { color: cores.perigo, fontSize: 14 },
  cartao: { backgroundColor: cores.cartao, borderRadius: 12, padding: 16, gap: 4, borderWidth: 1, borderColor: cores.borda },
  item: { backgroundColor: cores.cartao, borderRadius: 10, padding: 14, gap: 4, borderWidth: 1, borderColor: cores.borda },
  linha: { flexDirection: "row", gap: 8, marginTop: 6 },
  botaoPequeno: { paddingVertical: 8, paddingHorizontal: 12 },
});
