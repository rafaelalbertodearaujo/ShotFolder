/**
 * Ponte JavaScript ↔ módulo Kotlin do Keystore (android/.../ShotfolderKeystoreModule.kt).
 */
import { NativeModule, requireNativeModule } from "expo";

export type SecurityLevel = "strongbox" | "tee" | "software" | "desconhecido";

declare class ShotfolderKeystoreModule extends NativeModule<{}> {
  hasKey(alias: string): boolean;
  generateKey(alias: string): Promise<{ publicKeySpki: string; securityLevel: SecurityLevel }>;
  getPublicKey(alias: string): string;
  getSecurityLevel(alias: string): SecurityLevel;
  /** Assinatura SHA256withECDSA (DER, base64) do texto em UTF-8. */
  sign(alias: string, text: string): Promise<string>;
  deleteKey(alias: string): void;
}

export default requireNativeModule<ShotfolderKeystoreModule>("ShotfolderKeystore");
