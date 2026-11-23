/**
 * Pareamento por QR, em três passos:
 *   1. PC (CLI) pede um token de uso único, válido por 2 minutos, e mostra o QR.
 *   2. Celular lê o QR e manda { token, chave pública, nome } para POST /v1/pair.
 *      Essa requisição fica esperando (long-poll) a decisão no PC.
 *   3. No PC você confere o código de 6 dígitos (igual ao do celular) e aceita.
 *      Só então o aparelho entra em devices.json e o celular recebe o deviceId.
 *
 * Quem fotografar o QR e chegar antes queima o token, mas o código não bate com o
 * do seu celular e você recusa no PC.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { PAIR_PATTERNS } from "@shotfolder/protocol";
import { importDevicePublicKey, pairCode } from "@shotfolder/protocol/node";

export interface Candidate {
  deviceId: string;
  name: string;
  publicKey: string;
  code: string;
}

export interface PairOutcome {
  status: number;
  body: Record<string, string>;
}

type Pending =
  | { phase: "waiting"; token: string; expiresAt: number }
  | {
      phase: "confirming";
      token: string;
      expiresAt: number;
      candidate: Candidate;
      resolve: (o: PairOutcome) => void;
      timer: NodeJS.Timeout;
    };

export type PairStatus =
  | { phase: "none" }
  | { phase: "waiting"; expiresAt: number }
  | { phase: "confirming"; deviceName: string; code: string };

export interface PairingOptions {
  now: () => number;
  newDeviceId: () => string;
  /** Grava o aparelho aceito. */
  onAccept: (c: Candidate) => Promise<void>;
  ttlMs?: number;
  confirmMs?: number;
}

/** Compara tokens em tempo constante (o hash iguala os tamanhos). */
function sameToken(a: string, b: string): boolean {
  const h = (s: string) => createHash("sha256").update(s, "utf8").digest();
  return timingSafeEqual(h(a), h(b));
}

export class Pairing {
  private pending: Pending | null = null;
  private readonly ttlMs: number;
  private readonly confirmMs: number;

  constructor(private readonly opts: PairingOptions) {
    this.ttlMs = opts.ttlMs ?? 2 * 60_000;
    this.confirmMs = opts.confirmMs ?? 90_000;
  }

  /** Novo pareamento. Cancela qualquer um que estivesse aberto. */
  start(): { token: string; expiresAt: number } {
    this.cancel();
    const token = randomBytes(32).toString("base64url");
    const expiresAt = this.opts.now() + this.ttlMs;
    this.pending = { phase: "waiting", token, expiresAt };
    return { token, expiresAt };
  }

  status(): PairStatus {
    const p = this.pending;
    if (!p) return { phase: "none" };
    if (p.phase === "waiting") {
      if (this.opts.now() > p.expiresAt) {
        this.pending = null;
        return { phase: "none" };
      }
      return { phase: "waiting", expiresAt: p.expiresAt };
    }
    return { phase: "confirming", deviceName: p.candidate.name, code: p.candidate.code };
  }

  /** Chamado pelo celular. A promessa só termina quando o PC decide (ou expira). */
  submit(token: unknown, publicKey: unknown, deviceName: unknown): Promise<PairOutcome> {
    const p = this.pending;
    if (!p) return Promise.resolve({ status: 404, body: { error: "no_pairing" } });
    if (typeof token !== "string" || !PAIR_PATTERNS.token.test(token) || !sameToken(token, p.token)) {
      return Promise.resolve({ status: 401, body: { error: "invalid_token" } });
    }
    if (p.phase !== "waiting") return Promise.resolve({ status: 409, body: { error: "already_used" } });
    if (this.opts.now() > p.expiresAt) {
      this.pending = null;
      return Promise.resolve({ status: 410, body: { error: "expired" } });
    }
    if (typeof deviceName !== "string" || !PAIR_PATTERNS.deviceName.test(deviceName)) {
      return Promise.resolve({ status: 400, body: { error: "invalid_name" } });
    }
    if (typeof publicKey !== "string" || publicKey.length > 400) {
      return Promise.resolve({ status: 400, body: { error: "invalid_key" } });
    }
    try {
      importDevicePublicKey(publicKey);
    } catch {
      return Promise.resolve({ status: 400, body: { error: "invalid_key" } });
    }

    const candidate: Candidate = {
      deviceId: this.opts.newDeviceId(),
      name: deviceName,
      publicKey,
      code: pairCode(token, publicKey),
    };
    // A partir daqui o token está queimado: ninguém mais usa este QR.
    return new Promise<PairOutcome>((resolve) => {
      const timer = setTimeout(() => this.finish({ status: 408, body: { error: "not_confirmed" } }), this.confirmMs);
      this.pending = { phase: "confirming", token: p.token, expiresAt: p.expiresAt, candidate, resolve, timer };
    });
  }

  /** Decisão no PC. */
  async confirm(accept: boolean): Promise<{ ok: boolean; deviceId?: string; error?: string }> {
    const p = this.pending;
    if (!p || p.phase !== "confirming") return { ok: false, error: "nothing_to_confirm" };
    if (!accept) {
      this.finish({ status: 403, body: { error: "rejected" } });
      return { ok: true };
    }
    try {
      await this.opts.onAccept(p.candidate);
    } catch (e) {
      this.finish({ status: 500, body: { error: "internal_error" } });
      return { ok: false, error: (e as Error).message };
    }
    this.finish({ status: 201, body: { status: "paired", deviceId: p.candidate.deviceId } });
    return { ok: true, deviceId: p.candidate.deviceId };
  }

  cancel(): void {
    if (this.pending?.phase === "confirming") this.finish({ status: 410, body: { error: "cancelled" } });
    this.pending = null;
  }

  private finish(o: PairOutcome): void {
    const p = this.pending;
    if (p?.phase === "confirming") {
      clearTimeout(p.timer);
      p.resolve(o);
    }
    this.pending = null;
  }
}
