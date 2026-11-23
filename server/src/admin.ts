/**
 * API de administração, só em 127.0.0.1. Hoje serve apenas ao pareamento,
 * que precisa do servidor rodando. Pastas, aparelhos e log a CLI mexe direto
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
import { audit } from "./state.js";

export interface AdminDeps {
  stateDir: string;
  token: string;
  adminPort: number;
  /** Endereço que o celular usa (vai no QR). */
  publicHost: string;
  publicPort: number;
  pairing: Pairing;
  now?: () => number;
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

  app.addHook("onRequest", async (req, reply) => {
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

  app.post("/admin/pair/start", async () => {
    const { token, expiresAt } = deps.pairing.start();
    await audit(deps.stateDir, now(), { event: "pair_started" });
    return { uri: buildPairUri({ host: deps.publicHost, port: deps.publicPort, token }), expiresAt };
  });

  app.get("/admin/pair/status", async () => deps.pairing.status());

  app.post(
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

  app.post("/admin/pair/cancel", async () => {
    deps.pairing.cancel();
    return { ok: true };
  });

  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: "not_found" }));
  return app;
}
