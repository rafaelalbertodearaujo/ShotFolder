/**
 * Tela inicial: se não está pareado, leva ao pareamento; se está, lista as pastas do PC.
 */
import { randomUUID } from "expo-crypto";
import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";
import { ApiError, listFolders, type FolderList } from "../lib/api";
import { usePaired } from "../lib/paired-context";
import { Botao, cores } from "../lib/ui";

export default function Inicio() {
  const { loading, paired, forget } = usePaired();
  const [lista, setLista] = useState<FolderList | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  const atualizar = useCallback(async () => {
    if (!paired) return;
    setCarregando(true);
    setErro(null);
    try {
      setLista(await listFolders(paired.session, paired.signer, { now: Date.now, uuid: randomUUID }));
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Erro inesperado ao listar as pastas.");
    } finally {
      setCarregando(false);
    }
  }, [paired]);

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

  return (
    <View style={s.tela}>
      <View style={s.cartao}>
        <Text style={s.rotulo}>Pareado com o PC</Text>
        <Text style={s.texto}>
          {paired.session.host}:{paired.session.port}
        </Text>
        <Text style={s.suave}>
          {paired.deviceName} · {paired.session.deviceId}
        </Text>
      </View>

      <Text style={s.rotulo}>Pastas do PC</Text>
      {erro && <Text style={s.erro}>{erro}</Text>}
      <FlatList
        style={{ flexGrow: 0 }}
        data={lista?.folders ?? []}
        keyExtractor={(f) => f.id}
        refreshControl={<RefreshControl refreshing={carregando} onRefresh={() => void atualizar()} />}
        ListEmptyComponent={
          !carregando && !erro ? <Text style={s.suave}>Nenhuma pasta. No PC: shotfolder folders add …</Text> : undefined
        }
        renderItem={({ item }) => (
          <View style={s.pasta}>
            <Text style={s.texto}>{item.name}</Text>
            <Text style={s.suave}>
              {item.id}
              {item.id === lista?.defaultFolder ? " · padrão" : ""}
            </Text>
          </View>
        )}
      />
      <Botao tipo="secundario" onPress={() => void atualizar()} desativado={carregando}>
        Atualizar pastas
      </Botao>
      <Botao tipo="perigo" onPress={esquecer} style={{ marginTop: "auto" }}>
        Esquecer pareamento
      </Botao>
    </View>
  );
}

const s = StyleSheet.create({
  tela: { flex: 1, padding: 20, gap: 14 },
  centro: { flex: 1, alignItems: "center", justifyContent: "center" },
  titulo: { fontSize: 20, fontWeight: "700", color: cores.texto },
  texto: { fontSize: 16, color: cores.texto },
  suave: { fontSize: 13, color: cores.suave },
  rotulo: { fontSize: 13, fontWeight: "700", color: cores.suave, textTransform: "uppercase" },
  codigo: { fontFamily: "monospace", fontWeight: "600" },
  erro: { color: cores.perigo, fontSize: 14 },
  cartao: { backgroundColor: cores.cartao, borderRadius: 12, padding: 16, gap: 4, borderWidth: 1, borderColor: cores.borda },
  pasta: { backgroundColor: cores.cartao, borderRadius: 10, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: cores.borda },
});
