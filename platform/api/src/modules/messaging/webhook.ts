import type { FastifyPluginAsync } from "fastify";
import { prisma, type Prisma } from "../../lib/prisma.ts";
import { sha256 } from "../../lib/crypto.ts";
import { redis } from "../../lib/redis.ts";
import { toProviderAccount } from "./accounts.ts";
import { handleInboundEvents } from "./inbound.ts";
import { cloudApiProvider } from "./cloud-api.ts";
import { wuzapiProvider } from "./wuzapi.ts";
import type { MessagingProvider } from "./provider.ts";

/** Remove segredos que alguns provedores repetem no payload (ex.: token do usuário no WuzAPI). */
function scrub(payload: unknown) {
  if (!payload || typeof payload !== "object") return payload;
  const { token: _t, ...rest } = payload as Record<string, unknown>;
  return rest;
}

function dedupeKey(accountId: string, payload: Record<string, unknown>, raw: Buffer) {
  const evt = (payload.event ?? {}) as Record<string, unknown>;
  const info = (evt.Info ?? {}) as Record<string, unknown>;
  if (payload.type === "Message" && info.ID) return `wz:msg:${accountId}:${String(info.ID)}`;
  if (payload.type === "ReadReceipt" && Array.isArray(evt.MessageIDs)) return `wz:rcpt:${accountId}:${(evt.MessageIDs as string[]).join(",")}:${String(payload.state)}`;
  return `raw:${accountId}:${sha256(raw.toString("utf8"))}`;
}

function receiver(provider: MessagingProvider): FastifyPluginAsync {
  return async (app) => {
    // corpo bruto: a assinatura HMAC é calculada sobre os bytes exatos recebidos
    app.addContentTypeParser("application/json", { parseAs: "buffer", bodyLimit: 2 * 1024 * 1024 }, (_req, body, done) => done(null, body));
    app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "buffer", bodyLimit: 2 * 1024 * 1024 }, (_req, body, done) => done(null, body));

    app.post("/", { config: { public: true, skipCsrf: true, rateLimit: { max: 1200, timeWindow: "1 minute" } }, schema: { hide: true } }, async (req, reply) => {
      const raw = req.body as Buffer;
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(raw.toString("utf8"));
      } catch {
        return reply.code(400).send({ ok: false });
      }
      const key = provider.accountKeyFromPayload(payload);
      const account = key ? await prisma.messagingAccount.findFirst({ where: { provider: provider.kind, ...(provider.kind === "WUZAPI" ? { externalUserId: key } : { settings: { path: ["phoneNumberId"], equals: key } }) } }) : null;
      if (!account) {
        req.log.warn({ provider: provider.kind }, "webhook de conta desconhecida ignorado");
        return reply.code(202).send({ ok: true, ignored: true });
      }
      const pa = toProviderAccount(account);
      const valid = provider.verifySignature(raw, req.headers, pa);
      const eventType = String(payload.type ?? (payload.object as string | undefined) ?? "unknown");
      if (!valid) {
        await prisma.webhookEvent
          .create({ data: { messagingAccountId: account.id, provider: provider.kind, eventType, dedupeKey: `invalid:${sha256(raw.toString("utf8"))}`, signatureValid: false, payload: { rejected: true, type: eventType } } })
          .catch(() => undefined);
        req.log.warn({ accountId: account.id, eventType }, "webhook com assinatura HMAC inválida rejeitado");
        // evento sem assinatura: reaplica a chave no provedor (no máximo 1x por minuto por conta)
        const missing = !req.headers["x-hmac-signature"] && !req.headers["x-hub-signature-256"];
        if (missing && provider.ensureSignature && (await redis.set(`pp:hmac-rearm:${account.id}`, "1", "EX", 60, "NX"))) {
          provider.ensureSignature(pa).catch((err) => req.log.error({ err: (err as Error).message }, "falha ao reaplicar HMAC"));
        }
        return reply.code(401).send({ ok: false });
      }
      const dk = dedupeKey(account.id, payload, raw);
      try {
        await prisma.webhookEvent.create({ data: { messagingAccountId: account.id, provider: provider.kind, eventType, dedupeKey: dk, signatureValid: true, payload: scrub(payload) as Prisma.InputJsonValue } });
      } catch (err) {
        if ((err as { code?: string }).code === "P2002") return reply.send({ ok: true, duplicate: true });
        throw err;
      }
      try {
        await handleInboundEvents(account, provider.parseWebhook(payload));
        await prisma.webhookEvent.update({ where: { dedupeKey: dk }, data: { processedAt: new Date() } });
        return reply.send({ ok: true });
      } catch (err) {
        // remove o registro para que a retentativa do provedor seja processada
        await prisma.webhookEvent.delete({ where: { dedupeKey: dk } }).catch(() => undefined);
        req.log.error({ err: (err as Error).message }, "falha ao processar webhook");
        return reply.code(500).send({ ok: false });
      }
    });
  };
}

export const webhookRoutes: FastifyPluginAsync = async (app) => {
  await app.register(receiver(wuzapiProvider), { prefix: "/webhooks/wuzapi" });
  await app.register(receiver(cloudApiProvider), { prefix: "/webhooks/whatsapp-cloud" });
};
