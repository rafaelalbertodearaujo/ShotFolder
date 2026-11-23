/**
 * API de administração, só em 127.0.0.1: pareamento, status, desligar e o código de
 * entrada do painel web (que tem as próprias proteções, em panel.ts). Pastas, aparelhos e log a CLI mexe direto
 * nos arquivos (assim revogar funciona até com o servidor parado).
 *
 * Proteções contra um site aberto no navegador tentar falar com o localhost:
 *   - exige o token de admin (arquivo admin.token, que só o seu usuário lê);
 *   - recusa qualquer requisição com cabeçalho Origin (navegadores sempre mandam);
 *   - exige Host exatamente 127.0.0.1:<porta> (bloqueia DNS rebinding).
 */
import { createHash, timingSafeEqual } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import { buildPairUri } from "@shotfolder/protocol";
import type { Pairing } from "./pairing.js";
import { PanelSessions, registerPanel, type PanelDeps } from "./panel.js";
import { audit, type SeenStore } from "./state.js";

export interface AdminDeps {
  stateDir: string;
  token: string;
  adminPort: number;
  /** Endereço que o celular usa (vai no QR). */
  publicHost: string;
  publicPort: number;
  pairing: Pairing;
  now?: () => number;
  /** Chamado por POST /admin/shutdown (shotfolder stop). */
  onShutdown?: () => void;
  /** Com o registro de envios, o painel web é ligado em /painel/. */
  seen?: SeenStore;
  panel?: Partial<Pick<PanelDeps, "forbiddenRoots" | "recycle" | "reveal">>;
}

const digest = (s: string) => createHash("sha256").update(s, "utf8").digest();

export async function buildAdminApp(deps: AdminDeps): Promise<FastifyInstance> {
  const now = deps.now ?? Date.now;
  const expectedAuth = digest(`Bearer ${deps.token}`);
  const app = Fastify({
    logger: false,
    bodyLimit: 1024,
    ajv: { customOptions: { removeAdditional: false } },
  });

  const startedAt = new Date(now()).toISOString();
  const sessions = new PanelSessions(now);
  if (deps.seen) {
    registerPanel(app, {
      stateDir: deps.stateDir,
      adminPort: deps.adminPort,
      publicHost: deps.publicHost,
      publicPort: deps.publicPort,
      seen: deps.seen,
      sessions,
      startedAt,
      now,
      ...deps.panel,
    });
  }

  // Rotas /admin/*: só a CLI, com o token. Plugin separado para o hook não valer no painel.
  app.register(async (adm) => {
    adm.addHook("onRequest", async (req, reply) => {
      const auth = req.headers.authorization;
      const ok =
        req.headers.host === `127.0.0.1:${deps.adminPort}` &&
        req.headers.origin === undefined &&
        typeof auth === "string" &&
        timingSafeEqual(digest(auth), expectedAuth);
      if (!ok) {
        await audit(deps.stateDir, now(), { event: "admin_rejected", ip: req.ip, url: req.url }).catch(() => {});
        return reply.code(403).send({ error: "forbidden" });
      }
    });

    adm.post("/admin/panel/session", async () => ({ code: sessions.mintCode() }));

    adm.post("/admin/pair/start", async () => {
      const { token, expiresAt } = deps.pairing.start();
      await audit(deps.stateDir, now(), { event: "pair_started" });
      return { uri: buildPairUri({ host: deps.publicHost, port: deps.publicPort, token }), expiresAt };
    });

    adm.get("/admin/pair/status", async () => deps.pairing.status());

    adm.post(
      "/admin/pair/confirm",
      {
        schema: {
          body: {
            type: "object",
            required: ["accept"],
            additionalProperties: false,
            properties: { accept: { type: "boolean" } },
          },
        },
      },
      async (req, reply) => {
        const { accept } = req.body as { accept: boolean };
        const r = await deps.pairing.confirm(accept);
        if (!accept) await audit(deps.stateDir, now(), { event: "pair_rejected_by_user" });
        return reply.code(r.ok ? 200 : 409).send(r);
      },
    );

    adm.get("/admin/status", async () => ({
      pid: process.pid,
      host: deps.publicHost,
      port: deps.publicPort,
      startedAt,
    }));

    adm.post("/admin/shutdown", async (_req, reply) => {
      await audit(deps.stateDir, now(), { event: "server_stop_requested" });
      // Responde primeiro, depois desliga.
      reply.raw.once("finish", () => setTimeout(() => deps.onShutdown?.(), 50));
      return { ok: true };
    });

    adm.post("/admin/pair/cancel", async () => {
      deps.pairing.cancel();
      return { ok: true };
    });
  });

  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: "not_found" }));
  return app;
}
