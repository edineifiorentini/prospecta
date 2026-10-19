import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../src/lib/prisma.ts";
import { encryptSecret, hmacSha256Hex } from "../../src/lib/crypto.ts";
import { call, closeAll, getApp, resetDb, setupAdmin, type Agent } from "./helpers.ts";

const HMAC = "chave-hmac-de-teste-com-mais-de-32-caracteres";
const LEAD_PHONE = "+5519988887777";
let admin: Agent;
let accountId: string;
let companyId: string;

async function webhook(payload: Record<string, unknown>, opts: { sign?: boolean; key?: string } = {}) {
  const app = await getApp();
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.sign !== false) headers["x-hmac-signature"] = hmacSha256Hex(opts.key ?? HMAC, body);
  return app.inject({ method: "POST", url: "/api/webhooks/wuzapi", headers, payload: body });
}

const inbound = (id: string, text: string, fromMe = false) => ({
  type: "Message",
  userID: "42",
  instanceName: "teste",
  token: "NAO-DEVE-SER-GRAVADO",
  event: { Info: { ID: id, Chat: "5519988887777@s.whatsapp.net", IsFromMe: fromMe, IsGroup: false, PushName: "Maria", Timestamp: new Date().toISOString(), Type: "text" }, Message: { conversation: text } },
});

beforeAll(async () => {
  await resetDb();
  admin = await setupAdmin();
  const c = await call(admin, "POST", "/api/companies", { name: "Clínica Lead", phone: "(19) 98888-7777", city: "Campinas" });
  companyId = c.json().id;
  const acc = await prisma.messagingAccount.create({
    data: { organizationId: admin.organizationId, provider: "WUZAPI", name: "Teste", externalUserId: "42", tokenEncrypted: encryptSecret("token-teste"), hmacKeyEncrypted: encryptSecret(HMAC), status: "CONNECTED" },
  });
  accountId = acc.id;
});
afterAll(closeAll);

describe("webhook WuzAPI assinado (HMAC)", () => {
  it("rejeita assinatura ausente ou inválida", async () => {
    expect((await webhook(inbound("A0", "oi"), { sign: false })).statusCode).toBe(401);
    expect((await webhook(inbound("A0", "oi"), { key: "outra-chave-qualquer-com-32-caracteres!!" })).statusCode).toBe(401);
    expect(await prisma.message.count()).toBe(0);
  });

  it("registra mensagem recebida, vincula ao lead e não grava o token", async () => {
    const r = await webhook(inbound("ABC1", "Olá, gostaria de um orçamento"));
    expect(r.statusCode).toBe(200);
    const conv = await prisma.conversation.findFirstOrThrow({ include: { messages: true } });
    expect(conv.companyId).toBe(companyId);
    expect(conv.contactPhone).toBe(LEAD_PHONE);
    expect(conv.unreadCount).toBe(1);
    expect(conv.messages[0]).toMatchObject({ direction: "INBOUND", status: "RECEIVED", externalId: "ABC1" });
    const ev = await prisma.webhookEvent.findFirstOrThrow({ where: { signatureValid: true } });
    expect(JSON.stringify(ev.payload)).not.toContain("NAO-DEVE-SER-GRAVADO");
  });

  it("evento repetido não duplica a mensagem", async () => {
    expect((await webhook(inbound("ABC1", "Olá, gostaria de um orçamento"))).json().duplicate).toBe(true);
    expect(await prisma.message.count()).toBe(1);
  });

  it("ignora grupos", async () => {
    const g = inbound("G1", "msg de grupo");
    (g.event.Info as Record<string, unknown>).Chat = "123456@g.us";
    await webhook(g);
    expect(await prisma.message.count()).toBe(1);
  });
});

describe("política de envio", () => {
  it("permite responder dentro de 24 h após mensagem do contato", async () => {
    const conv = await prisma.conversation.findFirstOrThrow();
    const detail = (await call(admin, "GET", `/api/conversations/${conv.id}`)).json();
    expect(detail.decision).toMatchObject({ allowed: true, basis: "CUSTOMER_INITIATED" });
    const r = await call(admin, "POST", `/api/conversations/${conv.id}/messages`, { body: "Olá, Maria! Posso ajudar.", idempotencyKey: randomUUID() });
    expect(r.statusCode).toBe(201);
    expect(r.json().status).toBe("QUEUED");
  });

  it("chave de idempotência evita envio duplicado", async () => {
    const conv = await prisma.conversation.findFirstOrThrow();
    const key = randomUUID();
    const a = await call(admin, "POST", `/api/conversations/${conv.id}/messages`, { body: "Teste", idempotencyKey: key });
    const b = await call(admin, "POST", `/api/conversations/${conv.id}/messages`, { body: "Teste", idempotencyKey: key });
    expect(a.json().id).toBe(b.json().id);
  });

  it("bloqueia contato iniciado pela empresa sem consentimento (número público não autoriza)", async () => {
    const open = await call(admin, "POST", "/api/conversations", { accountId, phone: "(19) 97777-6666" });
    const r = await call(admin, "POST", `/api/conversations/${open.json().id}/messages`, { body: "Oferta", idempotencyKey: randomUUID() });
    expect(r.statusCode).toBe(403);
    expect(r.json().message).toMatch(/consentimento/i);
  });

  it("com consentimento registrado, mensagem de vendedor aguarda aprovação do gestor", async () => {
    const phone = "(19) 96666-5555";
    expect((await call(admin, "POST", "/api/consents", { contactValue: phone, legalBasis: "CONSENT", source: "Formulário do site", evidence: "Marcou a opção de receber contato por WhatsApp em 19/10/2026" })).statusCode).toBe(201);
    const hash = (await prisma.user.findUniqueOrThrow({ where: { email: "admin@test.local" } })).passwordHash;
    const seller = await prisma.user.create({ data: { email: "vendas@test.local", name: "Vendas", passwordHash: hash } });
    await prisma.membership.create({ data: { userId: seller.id, organizationId: admin.organizationId, role: "SALES" } });
    const { agentFromLogin } = await import("./helpers.ts");
    const s = await agentFromLogin("vendas@test.local", "senha-de-teste-123");
    const open = await call(s, "POST", "/api/conversations", { accountId, phone });
    const r = await call(s, "POST", `/api/conversations/${open.json().id}/messages`, { body: "Olá! Conforme combinado…", idempotencyKey: randomUUID() });
    expect(r.json().status).toBe("PENDING_APPROVAL");
    const pending = (await call(admin, "GET", "/api/messages/pending")).json();
    expect(pending).toHaveLength(1);
    expect((await call(admin, "POST", `/api/messages/${pending[0].id}/approve`, { approve: true })).statusCode).toBe(200);
    expect((await prisma.message.findUniqueOrThrow({ where: { id: pending[0].id } })).status).toBe("QUEUED");
  });

  it("pedido de interrupção bloqueia o número e revoga o consentimento", async () => {
    await webhook(inbound("STOP1", "PARAR"));
    expect(await prisma.suppressionEntry.count({ where: { value: LEAD_PHONE } })).toBe(1);
    const last = await prisma.contactConsent.findFirstOrThrow({ where: { contactValue: LEAD_PHONE }, orderBy: { createdAt: "desc" } });
    expect(last.status).toBe("REVOKED");
    const conv = await prisma.conversation.findFirstOrThrow({ where: { contactPhone: LEAD_PHONE } });
    const r = await call(admin, "POST", `/api/conversations/${conv.id}/messages`, { body: "Mais uma oferta", idempotencyKey: randomUUID() });
    expect(r.statusCode).toBe(403);
    expect(r.json().message).toMatch(/bloqueio/);
    // consentimento novo não é aceito enquanto estiver na lista de bloqueio
    expect((await call(admin, "POST", "/api/consents", { contactValue: LEAD_PHONE, legalBasis: "CONSENT", source: "Ligação telefônica", evidence: "Nova tentativa de autorização" })).statusCode).toBe(409);
  });

  it("recibos de leitura atualizam o status sem rebaixar", async () => {
    const msg = await prisma.message.findFirstOrThrow({ where: { direction: "OUTBOUND" } });
    await prisma.message.update({ where: { id: msg.id }, data: { status: "SENT", externalId: "OUT1" } });
    await webhook({ type: "ReadReceipt", userID: "42", state: "Read", event: { MessageIDs: ["OUT1"], Timestamp: new Date().toISOString() } });
    await webhook({ type: "ReadReceipt", userID: "42", state: "Delivered", event: { MessageIDs: ["OUT1"], Timestamp: new Date().toISOString() } });
    expect((await prisma.message.findUniqueOrThrow({ where: { id: msg.id } })).status).toBe("READ");
  });

  it("eventos de conexão atualizam o estado da conta", async () => {
    await webhook({ type: "LoggedOut", userID: "42", event: {} });
    expect((await prisma.messagingAccount.findUniqueOrThrow({ where: { id: accountId } })).status).toBe("LOGGED_OUT");
  });
});
