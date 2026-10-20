import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { prisma } from "../../lib/prisma.ts";
import { badRequest } from "../../lib/errors.ts";
import { sha256 } from "../../lib/crypto.ts";
import { writeAudit } from "../../lib/audit-log.ts";
import { normalizeEmail, normalizePhone } from "../../lib/normalize.ts";
import { orgId } from "../../plugins/auth.ts";
import { readOrgSettings } from "../orgs/settings.ts";
import { COLLECTION_CHANNEL } from "./suppression.ts";

const REDACTED = "[removido a pedido do titular]";
const subjectQuery = z.object({ value: z.string().trim().min(5).max(200) });

/** Normaliza o identificador do titular (e-mail ou telefone) e as formas como ele aparece em textos. */
function subjectOf(raw: string) {
  const email = raw.includes("@") ? normalizeEmail(raw) : null;
  if (email) return { kind: "EMAIL" as const, value: email, variants: [email] };
  const phone = normalizePhone(raw);
  if (!phone?.valid) throw badRequest("Informe um e-mail ou um telefone válido (com DDD).");
  const digits = phone.e164.replace(/\D/g, "");
  return { kind: "PHONE" as const, value: phone.e164, variants: [...new Set([phone.e164, digits, phone.national, digits.slice(2)].filter((v): v is string => !!v && v.length >= 8))] };
}

type Subject = ReturnType<typeof subjectOf>;

async function findSubject(organizationId: string, s: Subject) {
  const textMatch = s.variants.map((v) => ({ body: { contains: v, mode: "insensitive" as const } }));
  const [contacts, primaries, conversations, consents, suppression, activities, notes] = await Promise.all([
    prisma.contact.findMany({ where: { organizationId, normalizedValue: s.value }, include: { company: { select: { id: true, name: true, city: true } } } }),
    prisma.company.findMany({ where: { organizationId, OR: [{ primaryPhone: s.value }, { primaryEmail: s.value }] }, select: { id: true, name: true } }),
    s.kind === "PHONE"
      ? prisma.conversation.findMany({ where: { organizationId, contactPhone: s.value }, include: { _count: { select: { messages: true } }, company: { select: { id: true, name: true } } } })
      : Promise.resolve([]),
    prisma.contactConsent.findMany({ where: { organizationId, contactValue: s.value }, orderBy: { createdAt: "asc" } }),
    prisma.suppressionEntry.findMany({ where: { organizationId, value: s.value } }),
    prisma.activity.count({ where: { organizationId, OR: textMatch } }),
    prisma.note.count({ where: { organizationId, OR: textMatch } }),
  ]);
  return { contacts, primaries, conversations, consents, suppression, mentions: { activities, notes } };
}

export const privacyRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get("/privacy/overview", { config: { permission: "privacy:manage" }, schema: { tags: ["privacy"], summary: "Inventário de dados pessoais e regras de retenção" } }, async (req) => {
    const organizationId = orgId(req);
    const [org, contacts, conversations, messages, consents, suppression, webhookEvents, erasures, lastRetention] = await Promise.all([
      prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { settings: true } }),
      prisma.contact.groupBy({ by: ["type"], where: { organizationId }, _count: true }),
      prisma.conversation.count({ where: { organizationId } }),
      prisma.message.count({ where: { organizationId } }),
      prisma.contactConsent.count({ where: { organizationId } }),
      prisma.suppressionEntry.groupBy({ by: ["channel"], where: { organizationId }, _count: true }),
      prisma.webhookEvent.count({ where: { messagingAccount: { organizationId } } }),
      prisma.auditLog.count({ where: { organizationId, action: "privacy.erasure" } }),
      prisma.auditLog.findFirst({ where: { OR: [{ organizationId }, { organizationId: null }], action: { startsWith: "retention." } }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    ]);
    return {
      retention: readOrgSettings(org.settings).retention,
      counts: {
        contacts: Object.fromEntries(contacts.map((c) => [c.type, c._count])),
        conversations,
        messages,
        consents,
        suppression: Object.fromEntries(suppression.map((s) => [s.channel, s._count])),
        webhookEvents,
        erasures,
      },
      lastRetentionAt: lastRetention?.createdAt ?? null,
    };
  });

  app.get("/privacy/subject", { config: { permission: "privacy:manage" }, schema: { tags: ["privacy"], summary: "Localiza os dados de um titular (e-mail ou telefone)", querystring: subjectQuery } }, async (req) => {
    const organizationId = orgId(req);
    const s = subjectOf(req.query.value);
    const found = await findSubject(organizationId, s);
    await writeAudit(req, { action: "privacy.subject_lookup", metadata: { kind: s.kind, valueHash: sha256(s.value) } });
    return {
      subject: { kind: s.kind, value: s.value },
      contacts: found.contacts.map((c) => ({ id: c.id, type: c.type, value: c.value, status: c.status, source: c.source, sourceUrl: c.sourceUrl, collectedAt: c.collectedAt, company: c.company })),
      primaryOf: found.primaries,
      conversations: found.conversations.map((c) => ({ id: c.id, contactName: c.contactName, messages: c._count.messages, lastMessageAt: c.lastMessageAt, company: c.company })),
      consents: found.consents.map((c) => ({ id: c.id, status: c.status, legalBasis: c.legalBasis, source: c.source, createdAt: c.createdAt })),
      suppression: found.suppression.map((x) => ({ id: x.id, channel: x.channel, reason: x.reason, createdAt: x.createdAt })),
      mentions: found.mentions,
    };
  });

  app.get("/privacy/subject/export", { config: { permission: "privacy:manage" }, schema: { tags: ["privacy"], summary: "Exporta todos os dados do titular (JSON) para atender pedido de acesso", querystring: subjectQuery } }, async (req, reply) => {
    const organizationId = orgId(req);
    const s = subjectOf(req.query.value);
    const found = await findSubject(organizationId, s);
    const textMatch = s.variants.map((v) => ({ body: { contains: v, mode: "insensitive" as const } }));
    const [messages, activities, notes, fieldSources] = await Promise.all([
      prisma.message.findMany({ where: { conversationId: { in: found.conversations.map((c) => c.id) } }, orderBy: { createdAt: "asc" }, select: { conversationId: true, direction: true, body: true, status: true, createdAt: true, sentAt: true, deliveredAt: true, readAt: true } }),
      prisma.activity.findMany({ where: { organizationId, OR: textMatch }, select: { type: true, title: true, body: true, occurredAt: true, company: { select: { name: true } } } }),
      prisma.note.findMany({ where: { organizationId, OR: textMatch }, select: { body: true, createdAt: true, company: { select: { name: true } } } }),
      prisma.companyFieldSource.findMany({ where: { organizationId, value: s.value }, select: { field: true, source: true, sourceUrl: true, status: true, observedAt: true, company: { select: { name: true } } } }),
    ]);
    const payload = {
      generatedAt: new Date().toISOString(),
      subject: { kind: s.kind, value: s.value },
      note: "Dados encontrados na plataforma para este identificador, com a origem de cada registro.",
      contacts: found.contacts,
      companiesWherePrimary: found.primaries,
      fieldSources,
      conversations: found.conversations.map((c) => ({ ...c, messages: messages.filter((m) => m.conversationId === c.id) })),
      consents: found.consents,
      suppression: found.suppression,
      activities,
      notes,
    };
    await writeAudit(req, { action: "privacy.subject_exported", metadata: { kind: s.kind, valueHash: sha256(s.value) } });
    return reply
      .header("Content-Type", "application/json; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="dados-titular-${sha256(s.value).slice(0, 8)}.json"`)
      .send(JSON.stringify(payload, null, 2));
  });

  app.post(
    "/privacy/subject/erase",
    {
      config: { permission: "privacy:manage", rateLimit: { max: 20, timeWindow: "1 minute" } },
      schema: {
        tags: ["privacy"],
        summary: "Exclui os dados do titular e (opcionalmente) impede nova coleta e contato",
        body: z.object({ value: z.string().trim().min(5).max(200), reason: z.enum(["SUBJECT_REQUEST", "INCORRECT_DATA", "OTHER"]), notes: z.string().trim().max(500).optional(), suppress: z.boolean().default(true) }),
      },
    },
    async (req) => {
      const organizationId = orgId(req);
      const s = subjectOf(req.body.value);
      const like = s.variants.map((v) => `%${v.replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
      const counts = await prisma.$transaction(async (tx) => {
        const contacts = await tx.contact.deleteMany({ where: { organizationId, normalizedValue: s.value } });
        const phones = await tx.company.updateMany({ where: { organizationId, primaryPhone: s.value }, data: { primaryPhone: null, normPhone: null } });
        const emails = await tx.company.updateMany({ where: { organizationId, primaryEmail: s.value }, data: { primaryEmail: null } });
        const fieldSources = await tx.companyFieldSource.deleteMany({ where: { organizationId, value: s.value } });
        const conversations = s.kind === "PHONE" ? await tx.conversation.deleteMany({ where: { organizationId, contactPhone: s.value } }) : { count: 0 };
        const consents = await tx.contactConsent.deleteMany({ where: { organizationId, contactValue: s.value } });
        let redacted = 0;
        let rawCleared = 0;
        for (const pattern of like) {
          redacted += await tx.$executeRaw`UPDATE activities SET body = ${REDACTED} WHERE organization_id = ${organizationId}::uuid AND body ILIKE ${pattern}`;
          redacted += await tx.$executeRaw`UPDATE notes SET body = ${REDACTED} WHERE organization_id = ${organizationId}::uuid AND body ILIKE ${pattern}`;
          rawCleared += await tx.$executeRaw`UPDATE lead_sources SET raw_data = NULL WHERE organization_id = ${organizationId}::uuid AND raw_data::text ILIKE ${pattern}`;
          rawCleared += await tx.$executeRaw`UPDATE search_results r SET raw_data = NULL FROM search_jobs j WHERE r.search_job_id = j.id AND j.organization_id = ${organizationId}::uuid AND r.raw_data::text ILIKE ${pattern}`;
          rawCleared += await tx.$executeRaw`DELETE FROM webhook_events w USING messaging_accounts a WHERE w.messaging_account_id = a.id AND a.organization_id = ${organizationId}::uuid AND w.payload::text ILIKE ${pattern}`;
        }
        if (req.body.suppress) {
          const channels = s.kind === "PHONE" ? [COLLECTION_CHANNEL, "WHATSAPP"] : [COLLECTION_CHANNEL];
          for (const channel of channels) {
            await tx.suppressionEntry.upsert({
              where: { organizationId_channel_value: { organizationId, channel, value: s.value } },
              create: { organizationId, channel, value: s.value, reason: "ERASURE", source: "Exclusão a pedido do titular (LGPD)", createdById: req.auth!.userId },
              update: {},
            });
          }
        }
        return { contacts: contacts.count, primaryCleared: phones.count + emails.count, fieldSources: fieldSources.count, conversations: conversations.count, consents: consents.count, redacted, rawCleared };
      });
      // a trilha guarda apenas o hash do identificador
      await writeAudit(req, { action: "privacy.erasure", metadata: { kind: s.kind, valueHash: sha256(s.value), reason: req.body.reason, notes: req.body.notes, suppressed: req.body.suppress, ...counts } });
      return { ok: true, suppressed: req.body.suppress, ...counts };
    },
  );
};
