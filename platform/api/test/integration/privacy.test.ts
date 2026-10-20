import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../src/lib/prisma.ts";
import { upsertDiscovered } from "../../src/modules/companies/upsert.ts";
import { agentFromLogin, call, closeAll, resetDb, setupAdmin, type Agent } from "./helpers.ts";

const PHONE = "+5519991234567";
const EMAIL = "titular@clinica.example";
let admin: Agent;
let companyId: string;

beforeAll(async () => {
  await resetDb();
  admin = await setupAdmin();
  companyId = (await call(admin, "POST", "/api/companies", { name: "Consultório Titular", city: "Campinas", phone: "(19) 99123-4567" })).json().id;
  await call(admin, "POST", `/api/companies/${companyId}/contacts`, { type: "EMAIL", value: EMAIL });
  await call(admin, "POST", "/api/activities", { companyId, type: "CALL", title: "Ligação", body: "Pediu retorno no (19) 99123-4567 à tarde" });
  const account = await prisma.messagingAccount.create({ data: { organizationId: admin.organizationId, provider: "WUZAPI", name: "Teste" } });
  const conv = await prisma.conversation.create({ data: { organizationId: admin.organizationId, messagingAccountId: account.id, companyId, externalChatId: `${PHONE.slice(1)}@s.whatsapp.net`, contactPhone: PHONE } });
  await prisma.message.create({ data: { organizationId: admin.organizationId, conversationId: conv.id, direction: "INBOUND", body: "Olá, quero saber o preço", status: "RECEIVED" } });
  await prisma.contactConsent.create({ data: { organizationId: admin.organizationId, companyId, contactValue: PHONE, status: "GRANTED", legalBasis: "CONSENT", source: "Formulário", evidence: "Protocolo 123" } });
});
afterAll(closeAll);

describe("privacidade (LGPD)", () => {
  it("localiza os dados do titular por telefone em qualquer formato", async () => {
    const r = await call(admin, "GET", `/api/privacy/subject?value=${encodeURIComponent("19 99123 4567")}`);
    expect(r.statusCode).toBe(200);
    const d = r.json();
    expect(d.subject).toEqual({ kind: "PHONE", value: PHONE });
    expect(d.contacts).toHaveLength(1);
    expect(d.conversations[0].messages).toBe(1);
    expect(d.consents).toHaveLength(1);
    expect(d.mentions.activities).toBe(1);
  });

  it("exporta os dados em JSON e registra só o hash na trilha", async () => {
    const r = await call(admin, "GET", `/api/privacy/subject/export?value=${encodeURIComponent(PHONE)}`);
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-disposition"]).toContain("dados-titular-");
    const data = JSON.parse(r.body);
    expect(data.conversations[0].messages[0].body).toBe("Olá, quero saber o preço");
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: "privacy.subject_exported" } });
    expect(JSON.stringify(log.metadata)).not.toContain("99123");
  });

  it("exclui, anonimiza menções e impede nova coleta e contato", async () => {
    const r = await call(admin, "POST", "/api/privacy/subject/erase", { value: PHONE, reason: "SUBJECT_REQUEST", suppress: true });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ contacts: 1, conversations: 1, consents: 1 });
    expect(r.json().redacted).toBeGreaterThanOrEqual(1);

    expect(await prisma.contact.count({ where: { normalizedValue: PHONE } })).toBe(0);
    expect(await prisma.message.count()).toBe(0);
    expect((await prisma.company.findUniqueOrThrow({ where: { id: companyId } })).primaryPhone).toBeNull();
    const act = await prisma.activity.findFirstOrThrow({ where: { companyId, type: "CALL" } });
    expect(act.body).not.toContain("99123");
    const channels = (await prisma.suppressionEntry.findMany({ where: { value: PHONE } })).map((s) => s.channel).sort();
    expect(channels).toEqual(["COLLECTION", "WHATSAPP"]);

    // o e-mail do mesmo cadastro não foi afetado
    expect(await prisma.contact.count({ where: { normalizedValue: EMAIL } })).toBe(1);

    // não volta por cadastro manual nem por nova coleta
    const manual = await call(admin, "POST", `/api/companies/${companyId}/contacts`, { type: "PHONE", value: "(19) 99123-4567" });
    expect(manual.statusCode).toBe(409);
    await upsertDiscovered({ organizationId: admin.organizationId, source: "OSM_OVERPASS" }, { name: "Consultório Titular", city: "Campinas", phones: ["+55 19 99123-4567"], emails: [], raw: {} });
    expect(await prisma.contact.count({ where: { normalizedValue: PHONE } })).toBe(0);
  });

  it("apenas administradores acessam", async () => {
    const hash = (await prisma.user.findUniqueOrThrow({ where: { email: "admin@test.local" } })).passwordHash;
    const u = await prisma.user.create({ data: { email: "gestor@test.local", name: "Gestor", passwordHash: hash } });
    await prisma.membership.create({ data: { userId: u.id, organizationId: admin.organizationId, role: "MANAGER" } });
    const m = await agentFromLogin("gestor@test.local", "senha-de-teste-123");
    expect((await call(m, "GET", `/api/privacy/subject?value=${encodeURIComponent(EMAIL)}`)).statusCode).toBe(403);
    expect((await call(m, "POST", "/api/privacy/subject/erase", { value: EMAIL, reason: "OTHER" })).statusCode).toBe(403);
    const o = await call(admin, "GET", "/api/privacy/overview");
    expect(o.json().counts.erasures).toBe(1);
  });
});
