/**
 * Guarda o pareamento no SecureStore (criptografado com uma chave do Android Keystore).
 *
 * Etapa 6: a chave privada NÃO fica mais aqui. Ela vive só no Keystore (hardware) e
 * o SecureStore guarda apenas o "apelido" dela, o endereço do PC e o deviceId.
 */
import * as SecureStore from "expo-secure-store";
import { randomUUID } from "expo-crypto";
import Keystore from "../../modules/shotfolder-keystore";
import type { Session } from "./api";
import { KeystoreSigner } from "./keystore-signer";

const KEY = "shotfolder.session.v2";
const OLD_KEY = "shotfolder.session.v1"; // MVP: chave em software
const LAST_FOLDER = "shotfolder.lastFolder.v1";

interface Stored extends Session {
  keyAlias: string;
  deviceName: string;
}

export interface Paired {
  session: Session;
  signer: KeystoreSigner;
  deviceName: string;
}

/** Cria a chave do aparelho no Keystore (um apelido novo a cada pareamento). */
export function newSigner(): Promise<KeystoreSigner> {
  return KeystoreSigner.create(Keystore, `shotfolder-device-${randomUUID()}`);
}

export async function savePaired(session: Session, signer: KeystoreSigner, deviceName: string): Promise<void> {
  const anterior = await loadPaired();
  const data: Stored = { ...session, keyAlias: signer.alias, deviceName };
  await SecureStore.setItemAsync(KEY, JSON.stringify(data));
  // Pareou de novo: a chave antiga não serve mais para nada.
  if (anterior && anterior.signer.alias !== signer.alias) anterior.signer.destroy();
}

export async function loadPaired(): Promise<Paired | null> {
  // Pareamento do MVP (chave em software) não é mais aceito: apaga e pede para parear de novo.
  if (await SecureStore.getItemAsync(OLD_KEY)) await SecureStore.deleteItemAsync(OLD_KEY);
  const raw = await SecureStore.getItemAsync(KEY);
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as Stored;
    const signer = KeystoreSigner.load(Keystore, d.keyAlias);
    if (!signer) {
      // A chave sumiu do Keystore (dados do app apagados): o pareamento não vale mais.
      await SecureStore.deleteItemAsync(KEY);
      return null;
    }
    return { session: { host: d.host, port: d.port, deviceId: d.deviceId }, signer, deviceName: d.deviceName };
  } catch {
    return null;
  }
}

/** Apaga a chave e o pareamento deste celular. Para cortar o acesso de verdade, revogue também no PC. */
export async function forgetPaired(): Promise<void> {
  const p = await loadPaired();
  p?.signer.destroy();
  await SecureStore.deleteItemAsync(KEY);
  await SecureStore.deleteItemAsync(LAST_FOLDER);
}

/** Última pasta usada (vira a sugestão da próxima foto). */
export async function loadLastFolder(): Promise<string | null> {
  return SecureStore.getItemAsync(LAST_FOLDER);
}

export async function saveLastFolder(id: string): Promise<void> {
  await SecureStore.setItemAsync(LAST_FOLDER, id);
}
