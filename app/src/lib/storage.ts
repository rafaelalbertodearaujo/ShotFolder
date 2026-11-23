/**
 * Guarda o pareamento no SecureStore (criptografado com uma chave do Android Keystore).
 * No MVP isso inclui a chave privada em software; na etapa 6 ela sai daqui e passa a
 * viver só no Keystore.
 */
import * as SecureStore from "expo-secure-store";
import { getRandomValues } from "expo-crypto";
import { SoftwareSigner, type Signer } from "./crypto";
import type { Session } from "./api";

const KEY = "shotfolder.session.v1";

interface Stored extends Session {
  secretKeyHex: string;
  deviceName: string;
}

export interface Paired {
  session: Session;
  signer: Signer;
  deviceName: string;
}

export const randomBytes = (n: number): Uint8Array => getRandomValues(new Uint8Array(n));

export function newSigner(): SoftwareSigner {
  return SoftwareSigner.generate(randomBytes);
}

export async function savePaired(session: Session, signer: SoftwareSigner, deviceName: string): Promise<void> {
  const data: Stored = { ...session, secretKeyHex: signer.secretHex(), deviceName };
  await SecureStore.setItemAsync(KEY, JSON.stringify(data));
}

export async function loadPaired(): Promise<Paired | null> {
  const raw = await SecureStore.getItemAsync(KEY);
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as Stored;
    return {
      session: { host: d.host, port: d.port, deviceId: d.deviceId },
      signer: SoftwareSigner.fromSecretHex(d.secretKeyHex),
      deviceName: d.deviceName,
    };
  } catch {
    return null;
  }
}

/** Apaga só deste celular. Para cortar o acesso de verdade, revogue também no PC. */
export async function forgetPaired(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY);
}
