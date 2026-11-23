/**
 * Signer que usa a chave do Android Keystore (etapa 6). Sem import nativo aqui:
 * o módulo é injetado, para os testes rodarem no Node com um "Keystore" falso.
 */
import type { Signer } from "./crypto";

export type SecurityLevel = "strongbox" | "tee" | "software" | "desconhecido";

/** O que o módulo Kotlin (modules/shotfolder-keystore) oferece. */
export interface KeystoreNative {
  hasKey(alias: string): boolean;
  generateKey(alias: string): Promise<{ publicKeySpki: string; securityLevel: SecurityLevel }>;
  getPublicKey(alias: string): string;
  getSecurityLevel(alias: string): SecurityLevel;
  sign(alias: string, text: string): Promise<string>;
  deleteKey(alias: string): void;
}

/** A chave existe mas não assinou (quase sempre: celular bloqueado). */
export class KeyLockedError extends Error {
  constructor(cause?: unknown) {
    super("A chave do Keystore não assinou (o celular está bloqueado?).");
    this.cause = cause;
  }
}

export class KeystoreSigner implements Signer {
  private constructor(
    private readonly native: KeystoreNative,
    readonly alias: string,
    readonly publicKeySpki: string,
    readonly securityLevel: SecurityLevel,
  ) {}

  /** Gera um par novo. O apelido é único por pareamento. */
  static async create(native: KeystoreNative, alias: string): Promise<KeystoreSigner> {
    const { publicKeySpki, securityLevel } = await native.generateKey(alias);
    return new KeystoreSigner(native, alias, publicKeySpki, securityLevel);
  }

  /** Reabre uma chave já criada; `null` se ela sumiu (app reinstalado, dados apagados). */
  static load(native: KeystoreNative, alias: string): KeystoreSigner | null {
    if (!native.hasKey(alias)) return null;
    return new KeystoreSigner(native, alias, native.getPublicKey(alias), native.getSecurityLevel(alias));
  }

  async sign(text: string): Promise<string> {
    try {
      return await this.native.sign(this.alias, text);
    } catch (e) {
      throw new KeyLockedError(e);
    }
  }

  destroy(): void {
    this.native.deleteKey(this.alias);
  }
}

export function securityLevelLabel(l: SecurityLevel): string {
  switch (l) {
    case "strongbox":
      return "chip de segurança separado (StrongBox)";
    case "tee":
      return "área segura do processador (TEE)";
    case "software":
      return "software (o aparelho não tem hardware seguro)";
    default:
      return "local desconhecido";
  }
}
