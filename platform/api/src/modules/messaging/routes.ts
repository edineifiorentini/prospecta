import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { env } from "../../config/env.ts";
import { prisma, type Prisma } from "../../lib/prisma.ts";
import { badRequest, conflict, forbidden, notFound, tooMany, unavailable } from "../../lib/errors.ts";
import { encryptSecret } from "../../lib/crypto.ts";
import { writeAudit } from "../../lib/audit-log.ts";
import { normalizePhone } from "../../lib/normalize.ts";
import { enqueueMessage } from "../../queues/index.ts";
import { orgId } from "../../plugins/auth.ts";
import { can } from "../auth/rbac.ts";
import { providerFor, publicAccount, setAccountStatus, toProviderAccount, liveStatus } from "./accounts.ts";
import { decideSend, renderTemplate } from "./policy.ts";
import { ProviderError } from "./provider.ts";
import { ensureConversation } from "./inbound.ts";

const idParams = z.object({ id: z.uuid() });
const e164 = z.string().trim().transform((v, ctx) => {
  const p = normalizePhone(v);
  if (!p?.valid) {
    ctx.addIssue({ code: "custom", message: "Telefone inválido. Use DDD + número." });
    return z.NEVER;
  }
  return p.e164;
});

async function loadAccount(organizationId: string, id: string) {
  const a = await prisma.messagingAccount.findFirst({ where: { id, organizationId } });
  if (!a) throw notFound("Conta de mensagens não encontrada.");
  return a;
}

const wrap = async <T>(fn: () => Promise<T>) => {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ProviderError) throw err.status === 503 ? unavailable(err.message) : badRequest(err.message);
    throw err;
  }
};

export const messagingRoutes: FastifyPluginAsyncZod = async (app) => {
  // ── contas (WuzAPI / API oficial) ──
  app.get("/messaging/accounts", { schema: { tags: ["messaging"], summary: "Contas de WhatsApp da organização (sem segredos)" } }, async (req) => {
    const rows = await prisma.messagingAccount.findMany({ where: { organizationId: orgId(req) }, orderBy: { createdAt: "asc" } });
    return rows.map(publicAccount);
  });

  app.post(
    "/messaging/accounts",
    { config: { permission: "messaging:manage", rateLimit: { max: 5, timeWindow: "1 minute" } }, schema: { tags: ["messaging"], summary: "Cria instância no WuzAPI com webhook assinado (HMAC) e inicia a conexão", body: z.object({ name: z.string().trim().min(2).max(60) }) } },
    async (req, reply) => {
      const organizationId = orgId(req);
      if (!env.WUZAPI_ADMIN_TOKEN) throw unavailable("WUZAPI_ADMIN_TOKEN não configurado.");
      const prov = await wrap(() => providerFor("WUZAPI").provision(req.body.name, env.WUZAPI_WEBHOOK_URL));
      const account = await prisma.messagingAccount.create({
        data: { organizationId, provider: "WUZAPI", name: req.body.name, externalUserId: prov.externalUserId, tokenEncrypted: encryptSecret(prov.token), hmacKeyEncrypted: encryptSecret(prov.hmacKey), status: "CONNECTING" },
      });
      await wrap(() => providerFor("WUZAPI").connect(toProviderAccount(account)));
      await writeAudit(req, { action: "messaging.account_created", entityType: "messaging_account", entityId: account.id });
      return reply.code(201).send(publicAccount(account));
    },
  );

  app.post(
    "/messaging/accounts/cloud",
    {
      config: { permission: "messaging:manage" },
      schema: {
        tags: ["messaging"],
        summary: "Registra conta da WhatsApp Business Cloud API (oficial)",
        body: z.object({ name: z.string().trim().min(2).max(60), phoneNumberId: z.string().regex(/^\d{6,20}$/), accessToken: z.string().min(20).max(1000), appSecret: z.string().min(16).max(200), apiVersion: z.string().regex(/^v\d+\.\d+$/).default("v21.0"), verifyToken: z.string().min(16).max(200) }),
      },
    },
    async (req, reply) => {
      const b = req.body;
      const account = await prisma.messagingAccount.create({
        data: { organizationId: orgId(req), provider: "WHATSAPP_CLOUD", name: b.name, externalUserId: b.phoneNumberId, tokenEncrypted: encryptSecret(b.accessToken), hmacKeyEncrypted: encryptSecret(b.appSecret), settings: { phoneNumberId: b.phoneNumberId, apiVersion: b.apiVersion, verifyTokenHash: encryptSecret(b.verifyToken) }, status: "DISCONNECTED" },
      });
      await writeAudit(req, { action: "messaging.cloud_account_created", entityType: "messaging_account", entityId: account.id });
      return reply.code(201).send(publicAccount(account));
    },
  );

  app.post("/messaging/accounts/:id/connect", { config: { permission: "messaging:manage" }, schema: { tags: ["messaging"], summary: "Reconecta de forma controlada (gera QR se necessário)", params: idParams } }, async (req) => {
    const a = await loadAccount(orgId(req), req.params.id);
    await wrap(() => providerFor(a.provider).connect(toProviderAccount(a)));
    await setAccountStatus(a.id, "CONNECTING", { lastError: null });
    await writeAudit(req, { action: "messaging.reconnect", entityType: "messaging_account", entityId: a.id });
    return { ok: true };
  });

  app.get("/messaging/accounts/:id/status", { schema: { tags: ["messaging"], params: idParams } }, async (req) => {
    const a = await loadAccount(orgId(req), req.params.id);
    const s = await wrap(() => liveStatus(a));
    if (s.status !== a.status || (s.jid && s.jid !== a.phoneJid)) await setAccountStatus(a.id, s.status, { phoneJid: s.jid ?? a.phoneJid });
    return { ...publicAccount({ ...a, status: s.status, phoneJid: s.jid ?? a.phoneJid }) };
  });

  app.get("/messaging/accounts/:id/qr", { config: { permission: "messaging:manage" }, schema: { tags: ["messaging"], summary: "QR Code atual para parear o WhatsApp (data URL)", params: idParams } }, async (req) => {
    const a = await loadAccount(orgId(req), req.params.id);
    const p = toProviderAccount(a);
    const s = await wrap(() => providerFor(a.provider).status(p));
    if (s.status === "CONNECTED") {
      await setAccountStatus(a.id, "CONNECTED", { phoneJid: s.jid, lastError: null });
      return { status: "CONNECTED" as const, qr: null };
    }
    const qr = await wrap(() => providerFor(a.provider).qr(p));
    if (qr && a.status !== "QR_PENDING") await setAccountStatus(a.id, "QR_PENDING");
    return { status: qr ? ("QR_PENDING" as const) : s.status, qr };
  });

  app.post("/messaging/accounts/:id/disconnect", { config: { permission: "messaging:manage" }, schema: { tags: ["messaging"], params: idParams } }, async (req) => {
    const a = await loadAccount(orgId(req), req.params.id);
    await wrap(() => providerFor(a.provider).disconnect(toProviderAccount(a)));
    await setAccountStatus(a.id, "DISCONNECTED", { lastError: "Desconectado manualmente." });
    await writeAudit(req, { action: "messaging.disconnect", entityType: "messaging_account", entityId: a.id });
    return { ok: true };
  });

  app.post("/messaging/accounts/:id/logout", { config: { permission: "messaging:manage" }, schema: { tags: ["messaging"], summary: "Encerra a sessão (exigirá novo QR Code)", params: idParams } }, async (req) => {
    const a = await loadAccount(orgId(req), req.params.id);
    await wrap(() => providerFor(a.provider).logout(toProviderAccount(a)));
    await setAccountStatus(a.id, "LOGGED_OUT", { lastError: "Sessão encerrada pelo usuário.", phoneJid: null });
    await writeAudit(req, { action: "messaging.logout", entityType: "messaging_account", entityId: a.id });
    return { ok: true };
  });

  app.delete("/messaging/accounts/:id", { config: { permission: "messaging:manage" }, schema: { tags: ["messaging"], summary: "Remove a conta (o histórico de conversas é excluído junto)", params: idParams } }, async (req) => {
    const a = await loadAccount(orgId(req), req.params.id);
    await providerFor(a.provider).deprovision(toProviderAccount(a));
    await prisma.messagingAccount.delete({ where: { id: a.id } });
    await writeAudit(req, { action: "messaging.account_deleted", entityType: "messaging_account", entityId: a.id });
    return { ok: true };
  });

  // ── conversas ──
  app.get(
    "/conversations",
    { schema: { tags: ["messaging"], querystring: z.object({ q: z.string().max(100).optional(), unread: z.coerce.boolean().optional(), companyId: z.uuid().optional(), take: z.coerce.number().int().min(1).max(200).default(60) }) } },
    async (req) => {
      const q = req.query;
      const where: Prisma.ConversationWhereInput = {
        organizationId: orgId(req),
        ...(q.unread ? { unreadCount: { gt: 0 } } : {}),
        ...(q.companyId ? { companyId: q.companyId } : {}),
        ...(q.q ? { OR: [{ contactName: { contains: q.q, mode: "insensitive" } }, { contactPhone: { contains: q.q.replace(/\D/g, "") || q.q } }, { company: { name: { contains: q.q, mode: "insensitive" } } }] } : {}),
      };
      const rows = await prisma.conversation.findMany({
        where,
        orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
        take: q.take,
        include: { company: { select: { id: true, name: true } }, messages: { orderBy: { createdAt: "desc" }, take: 1, select: { body: true, direction: true, status: true, createdAt: true } }, messagingAccount: { select: { id: true, name: true, status: true } } },
      });
      return rows.map(({ messages, ...c }) => ({ ...c, lastMessage: messages[0] ?? null }));
    },
  );

  app.post(
    "/conversations",
    { config: { permission: "messages:send" }, schema: { tags: ["messaging"], summary: "Abre conversa com um número (o envio segue as regras de consentimento)", body: z.object({ accountId: z.uuid(), phone: e164, companyId: z.uuid().optional() }) } },
    async (req, reply) => {
      const organizationId = orgId(req);
      const account = await loadAccount(organizationId, req.body.accountId);
      if (req.body.companyId && !(await prisma.company.findFirst({ where: { id: req.body.companyId, organizationId } }))) throw notFound("Empresa não encontrada.");
      const chatId = `${req.body.phone.replace(/\D/g, "")}@s.whatsapp.net`;
      const conv = await ensureConversation(account, chatId, req.body.phone);
      if (req.body.companyId && !conv.companyId) await prisma.conversation.update({ where: { id: conv.id }, data: { companyId: req.body.companyId } });
      return reply.code(201).send({ id: conv.id });
    },
  );

  app.get("/conversations/:id", { schema: { tags: ["messaging"], summary: "Mensagens da conversa e situação de envio (consentimento/opt-out)", params: idParams } }, async (req) => {
    const organizationId = orgId(req);
    const conv = await prisma.conversation.findFirst({
      where: { id: req.params.id, organizationId },
      include: { company: { select: { id: true, name: true } }, messagingAccount: { select: { id: true, name: true, status: true, provider: true } }, messages: { orderBy: { createdAt: "asc" }, take: 500, include: { sentBy: { select: { name: true } }, approvedBy: { select: { name: true } } } } },
    });
    if (!conv) throw notFound("Conversa não encontrada.");
    if (conv.unreadCount > 0) await prisma.conversation.update({ where: { id: conv.id }, data: { unreadCount: 0 } });
    const decision = await decideSend(organizationId, conv.contactPhone, { lastInboundAt: conv.lastInboundAt, accountId: conv.messagingAccountId });
    const consent = await prisma.contactConsent.findFirst({ where: { organizationId, channel: "WHATSAPP", contactValue: conv.contactPhone }, orderBy: { createdAt: "desc" } });
    return { ...conv, decision, consent };
  });

  app.post(
    "/conversations/:id/messages",
    {
      config: { permission: "messages:send", rateLimit: { max: 30, timeWindow: "1 minute" } },
      schema: { tags: ["messaging"], summary: "Envia mensagem manual (sujeita a consentimento, opt-out, limites e aprovação)", params: idParams, body: z.object({ body: z.string().trim().min(1).max(4096), templateId: z.uuid().optional(), idempotencyKey: z.uuid() }) },
    },
    async (req, reply) => {
      const organizationId = orgId(req);
      const conv = await prisma.conversation.findFirst({ where: { id: req.params.id, organizationId }, include: { messagingAccount: true } });
      if (!conv) throw notFound("Conversa não encontrada.");
      const existing = await prisma.message.findUnique({ where: { idempotencyKey: req.body.idempotencyKey } });
      if (existing) {
        if (existing.conversationId !== conv.id) throw conflict("Chave de idempotência já usada em outra conversa.");
        return reply.code(200).send(existing);
      }
      if (req.body.templateId && !(await prisma.messageTemplate.findFirst({ where: { id: req.body.templateId, organizationId } }))) throw notFound("Modelo de mensagem não encontrado.");
      if (conv.messagingAccount.status !== "CONNECTED") throw unavailable("O WhatsApp não está conectado. Conecte a conta em Configurações → WhatsApp.");
      const decision = await decideSend(organizationId, conv.contactPhone, { lastInboundAt: conv.lastInboundAt, accountId: conv.messagingAccountId });
      if (!decision.allowed) {
        await writeAudit(req, { action: "message.blocked", entityType: "conversation", entityId: conv.id, metadata: { reason: decision.reason } });
        if (decision.reason === "RATE_LIMIT") throw tooMany(decision.detail);
        throw forbidden(decision.detail);
      }
      const needsApproval = decision.requiresApproval && !can(req.auth!.role, "messages:approve");
      const msg = await prisma.message.create({
        data: {
          organizationId,
          conversationId: conv.id,
          direction: "OUTBOUND",
          idempotencyKey: req.body.idempotencyKey,
          body: req.body.body,
          templateId: req.body.templateId ?? null,
          status: needsApproval ? "PENDING_APPROVAL" : "QUEUED",
          sentById: req.auth!.userId,
          ...(decision.requiresApproval && !needsApproval ? { approvedById: req.auth!.userId, approvedAt: new Date() } : {}),
        },
      });
      if (!needsApproval) await enqueueMessage({ messageId: msg.id });
      await writeAudit(req, { action: needsApproval ? "message.pending_approval" : "message.queued", entityType: "message", entityId: msg.id, metadata: { basis: decision.basis } });
      return reply.code(201).send(msg);
    },
  );

  app.get("/messages/pending", { config: { permission: "messages:approve" }, schema: { tags: ["messaging"], summary: "Mensagens aguardando aprovação" } }, async (req) =>
    prisma.message.findMany({ where: { organizationId: orgId(req), status: "PENDING_APPROVAL" }, orderBy: { createdAt: "asc" }, include: { conversation: { select: { id: true, contactPhone: true, contactName: true, company: { select: { id: true, name: true } } } }, sentBy: { select: { name: true } } } }),
  );

  app.post("/messages/:id/approve", { config: { permission: "messages:approve" }, schema: { tags: ["messaging"], params: idParams, body: z.object({ approve: z.boolean(), reason: z.string().max(300).optional() }) } }, async (req) => {
    const organizationId = orgId(req);
    const msg = await prisma.message.findFirst({ where: { id: req.params.id, organizationId, status: "PENDING_APPROVAL" }, include: { conversation: true } });
    if (!msg) throw notFound("Mensagem não está aguardando aprovação.");
    if (!req.body.approve) {
      await prisma.message.update({ where: { id: msg.id }, data: { status: "BLOCKED", error: `Rejeitada por ${req.auth!.name}${req.body.reason ? `: ${req.body.reason}` : ""}`, approvedById: req.auth!.userId, approvedAt: new Date() } });
      await writeAudit(req, { action: "message.rejected", entityType: "message", entityId: msg.id });
      return { ok: true };
    }
    const decision = await decideSend(organizationId, msg.conversation.contactPhone, { lastInboundAt: msg.conversation.lastInboundAt, accountId: msg.conversation.messagingAccountId });
    if (!decision.allowed) throw forbidden(decision.detail);
    await prisma.message.update({ where: { id: msg.id }, data: { status: "QUEUED", approvedById: req.auth!.userId, approvedAt: new Date() } });
    await enqueueMessage({ messageId: msg.id });
    await writeAudit(req, { action: "message.approved", entityType: "message", entityId: msg.id });
    return { ok: true };
  });

  // ── modelos de mensagem ──
  app.get("/message-templates", { schema: { tags: ["messaging"] } }, async (req) => prisma.messageTemplate.findMany({ where: { organizationId: orgId(req) }, orderBy: { name: "asc" } }));

  const templateBody = z.object({ name: z.string().trim().min(2).max(80), body: z.string().trim().min(1).max(4096), category: z.string().max(40).default("ATENDIMENTO"), isActive: z.boolean().default(true) });
  app.post("/message-templates", { config: { permission: "messaging:manage" }, schema: { tags: ["messaging"], body: templateBody } }, async (req, reply) => {
    const t = await prisma.messageTemplate.create({ data: { organizationId: orgId(req), ...req.body } }).catch((e: { code?: string }) => {
      if (e.code === "P2002") throw conflict("Já existe um modelo com esse nome.");
      throw e;
    });
    return reply.code(201).send(t);
  });
  app.patch("/message-templates/:id", { config: { permission: "messaging:manage" }, schema: { tags: ["messaging"], params: idParams, body: templateBody.partial() } }, async (req) => {
    const t = await prisma.messageTemplate.findFirst({ where: { id: req.params.id, organizationId: orgId(req) } });
    if (!t) throw notFound();
    return prisma.messageTemplate.update({ where: { id: t.id }, data: req.body });
  });
  app.delete("/message-templates/:id", { config: { permission: "messaging:manage" }, schema: { tags: ["messaging"], params: idParams } }, async (req) => {
    const t = await prisma.messageTemplate.findFirst({ where: { id: req.params.id, organizationId: orgId(req) } });
    if (!t) throw notFound();
    await prisma.messageTemplate.delete({ where: { id: t.id } });
    return { ok: true };
  });
  app.post("/message-templates/:id/render", { schema: { tags: ["messaging"], summary: "Pré-visualiza o modelo para uma conversa", params: idParams, body: z.object({ conversationId: z.uuid() }) } }, async (req) => {
    const organizationId = orgId(req);
    const [t, conv, org] = await Promise.all([
      prisma.messageTemplate.findFirst({ where: { id: req.params.id, organizationId } }),
      prisma.conversation.findFirst({ where: { id: req.body.conversationId, organizationId }, include: { company: { select: { name: true } } } }),
      prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { name: true } }),
    ]);
    if (!t || !conv) throw notFound();
    return { body: renderTemplate(t.body, { contato: conv.contactName?.split(" ")[0] ?? "", empresa: conv.company?.name ?? "", usuario: req.auth!.name.split(" ")[0], organizacao: org.name }) };
  });

  // ── consentimento e lista de bloqueio ──
  app.get("/consents", { schema: { tags: ["consent"], querystring: z.object({ contactValue: z.string().max(40).optional(), companyId: z.uuid().optional(), take: z.coerce.number().int().min(1).max(200).default(100) }) } }, async (req) => {
    const q = req.query;
    const phone = q.contactValue ? (normalizePhone(q.contactValue)?.e164 ?? q.contactValue) : undefined;
    return prisma.contactConsent.findMany({
      where: { organizationId: orgId(req), ...(phone ? { contactValue: phone } : {}), ...(q.companyId ? { companyId: q.companyId } : {}) },
      orderBy: { createdAt: "desc" },
      take: q.take,
      include: { recordedBy: { select: { name: true } }, company: { select: { id: true, name: true } } },
    });
  });

  app.post(
    "/consents",
    {
      config: { permission: "consent:manage" },
      schema: {
        tags: ["consent"],
        summary: "Registra autorização de contato (fonte, data e evidência obrigatórias)",
        body: z.object({
          contactValue: e164,
          companyId: z.uuid().optional(),
          legalBasis: z.enum(["CONSENT", "LEGITIMATE_INTEREST", "CONTRACT"]),
          source: z.string().trim().min(3).max(200),
          evidence: z.string().trim().min(3).max(2000),
          grantedAt: z.coerce.date().optional(),
        }),
      },
    },
    async (req, reply) => {
      const organizationId = orgId(req);
      const b = req.body;
      if (b.companyId && !(await prisma.company.findFirst({ where: { id: b.companyId, organizationId } }))) throw notFound("Empresa não encontrada.");
      const suppressed = await prisma.suppressionEntry.findUnique({ where: { organizationId_channel_value: { organizationId, channel: "WHATSAPP", value: b.contactValue } } });
      if (suppressed) throw conflict("Este número pediu para não receber mensagens (lista de bloqueio). Só um administrador pode retirá-lo, com nova autorização documentada.");
      const c = await prisma.contactConsent.create({
        data: { organizationId, companyId: b.companyId ?? null, channel: "WHATSAPP", contactValue: b.contactValue, status: "GRANTED", legalBasis: b.legalBasis, source: b.source, evidence: b.evidence, grantedAt: b.grantedAt ?? new Date(), recordedById: req.auth!.userId },
      });
      if (b.companyId) await prisma.activity.create({ data: { organizationId, companyId: b.companyId, userId: req.auth!.userId, type: "CONSENT", title: "Autorização de contato registrada", body: `${b.source} — ${b.evidence.slice(0, 200)}`, metadata: { consentId: c.id, channel: "WHATSAPP" } } });
      await writeAudit(req, { action: "consent.granted", entityType: "contact_consent", entityId: c.id, metadata: { legalBasis: b.legalBasis } });
      return reply.code(201).send(c);
    },
  );

  app.post("/consents/revoke", { config: { permission: "consent:manage" }, schema: { tags: ["consent"], body: z.object({ contactValue: e164, reason: z.string().trim().min(3).max(300), suppress: z.boolean().default(true) }) } }, async (req) => {
    const organizationId = orgId(req);
    const last = await prisma.contactConsent.findFirst({ where: { organizationId, channel: "WHATSAPP", contactValue: req.body.contactValue }, orderBy: { createdAt: "desc" } });
    await prisma.contactConsent.create({ data: { organizationId, companyId: last?.companyId ?? null, channel: "WHATSAPP", contactValue: req.body.contactValue, status: "REVOKED", legalBasis: last?.legalBasis ?? "CONSENT", source: "Revogação manual", evidence: req.body.reason, revokedAt: new Date(), recordedById: req.auth!.userId } });
    if (req.body.suppress) {
      await prisma.suppressionEntry.upsert({ where: { organizationId_channel_value: { organizationId, channel: "WHATSAPP", value: req.body.contactValue } }, create: { organizationId, channel: "WHATSAPP", value: req.body.contactValue, reason: "MANUAL", source: req.body.reason, createdById: req.auth!.userId }, update: {} });
    }
    await writeAudit(req, { action: "consent.revoked", metadata: { suppress: req.body.suppress } });
    return { ok: true };
  });

  app.get("/suppression", { schema: { tags: ["consent"], summary: "Lista de bloqueio (WHATSAPP: não enviar; COLLECTION: não coletar de novo)", querystring: z.object({ channel: z.enum(["WHATSAPP", "COLLECTION"]).optional() }) } }, async (req) =>
    prisma.suppressionEntry.findMany({ where: { organizationId: orgId(req), ...(req.query.channel ? { channel: req.query.channel } : {}) }, orderBy: { createdAt: "desc" }, take: 500 }),
  );

  app.post("/suppression", { config: { permission: "consent:manage" }, schema: { tags: ["consent"], body: z.object({ value: e164, reason: z.enum(["OPT_OUT", "MANUAL", "COMPLAINT"]).default("MANUAL"), source: z.string().max(200).optional() }) } }, async (req, reply) => {
    const organizationId = orgId(req);
    const s = await prisma.suppressionEntry.upsert({
      where: { organizationId_channel_value: { organizationId, channel: "WHATSAPP", value: req.body.value } },
      create: { organizationId, channel: "WHATSAPP", value: req.body.value, reason: req.body.reason, source: req.body.source, createdById: req.auth!.userId },
      update: {},
    });
    await writeAudit(req, { action: "suppression.added", entityType: "suppression", entityId: s.id });
    return reply.code(201).send(s);
  });

  app.delete("/suppression/:id", { config: { permission: "privacy:manage" }, schema: { tags: ["consent"], summary: "Remove da lista de bloqueio (somente administradores; auditado)", params: idParams, body: z.object({ justification: z.string().trim().min(10).max(500) }) } }, async (req) => {
    const organizationId = orgId(req);
    const s = await prisma.suppressionEntry.findFirst({ where: { id: req.params.id, organizationId } });
    if (!s) throw notFound();
    await prisma.suppressionEntry.delete({ where: { id: s.id } });
    await writeAudit(req, { action: "suppression.removed", entityType: "suppression", entityId: s.id, metadata: { justification: req.body.justification } });
    return { ok: true };
  });
};
