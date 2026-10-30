import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/prisma.ts";
import { setAdapterForTests } from "../../src/modules/ai/registry.ts";
import type { AiProviderAdapter, AiProviderId } from "../../src/modules/ai/types.ts";
import { agentFromLogin, call, closeAll, getApp, resetDb, setupAdmin, type Agent } from "./helpers.ts";

let admin: Agent;
let other: Agent;
let companyId: string;

const OUTPUT = {
  summary: "Imobiliária em Umuarama com WhatsApp divulgado e ficha no Google.",
  verifiedFacts: [{ fact: "Atua como imobiliária", evidenceIds: ["E1"] }, { fact: "Inventado", evidenceIds: ["E77"] }],
  opportunityHypotheses: [{ hypothesis: "Talvez vários corretores dividam o mesmo número", basis: "Um WhatsApp divulgado", evidenceIds: ["E2"], confidence: "baixa" }],
  diagnosticQuestions: ["Quem responde primeiro os interessados?", "Os corretores usam celular próprio?"],
  personalizedMessage: "Olá! Vi que vocês atendem pelo WhatsApp. Posso entender como a equipe divide os contatos hoje?",
  possibleObjections: [{ objection: "Já temos WhatsApp Business", response: "Faz sentido; a proposta é organizar a equipe no mesmo número." }],
  recommendedNextAction: { action: "QUALIFY_OPERATION", rationale: "Entender o atendimento." },
  confidence: "media",
  limitations: ["Não sabemos quantos corretores há."],
};

/** Provedor falso: nenhuma chamada sai da máquina. */
function fakeProvider(id: AiProviderId, spy = vi.fn()): AiProviderAdapter {
  return {
    id,
    isConfigured: () => true,
    listModels: async () => ["modelo-a", "modelo-b"],
    generateStructured: async (req) => {
      spy(req);
      return { text: JSON.stringify(OUTPUT), modelUsed: req.model, usage: { inputTokens: 2000, outputTokens: 800, reasoningTokens: null, totalTokens: 2800, billableOutputTokens: 800, providerCostUsd: null }, requestId: "fake", notes: [] };
    },
  };
}

const AI = { enabled: true, mode: "manual", primaryProvider: "openai", fallbackProviders: [], autoPolicy: "priority", models: {}, offering: "um sistema de gestão de atendimento pelo WhatsApp para equipes", maxCostUsdPerAnalysis: 0.2, allowUnknownCost: false, maxOutputTokens: 6000, timeoutSeconds: 30, maxRetries: 0, cacheDays: 30 };

beforeAll(async () => {
  await resetDb();
  admin = await setupAdmin();
  const created = await call(admin, "POST", "/api/companies", { name: "Imobiliária Teste", category: "Imobiliária", city: "Umuarama", state: "PR", phone: "(44) 3622-1234" });
  expect(created.statusCode).toBe(201);
  companyId = created.json().id;
  expect((await call(admin, "POST", `/api/companies/${companyId}/contacts`, { type: "WHATSAPP", value: "(44) 99912-3456" })).statusCode).toBeLessThan(300);
  // outra conta, para conferir o isolamento
  const acc = await call(admin, "POST", "/api/platform/accounts", { organizationName: "Outra Conta", name: "Outro Dono", email: "outro@conta.test" });
  const token = new URL(acc.json().inviteLink).searchParams.get("token")!;
  await (await getApp()).inject({ method: "POST", url: "/api/auth/reset", payload: { token, password: "senha-de-teste-456" } });
  other = await agentFromLogin("outro@conta.test", "senha-de-teste-456");
});
afterEach(() => (["openai", "anthropic", "xai", "gemini", "groq"] as const).forEach((p) => setAdapterForTests(p, null)));
afterAll(closeAll);

describe("inteligência comercial", () => {
  it("devolve os três indicadores com evidências e telefones analisados", async () => {
    const r = await call(admin, "GET", `/api/companies/${companyId}/intelligence`);
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(Object.keys(body.indicators)).toEqual(["FIT", "OPPORTUNITY", "RELIABILITY"]);
    expect(body.segment.id).toBe("imobiliaria");
    expect(body.phones.map((p: { kind: string; whatsapp: string }) => [p.kind, p.whatsapp])).toEqual([["MOBILE", "CONFIRMED"], ["FIXED", "NOT_CONFIRMED"]]);
    expect(["A", "B", "C", "NEEDS_QUALIFICATION"]).toContain(body.priority);
  });

  it("outra conta não enxerga a empresa nem as análises", async () => {
    expect((await call(other, "GET", `/api/companies/${companyId}/intelligence`)).statusCode).toBe(404);
    expect((await call(other, "GET", `/api/companies/${companyId}/ai-analyses`)).statusCode).toBe(404);
  });

  it("IA começa desligada e as chaves nunca aparecem", async () => {
    const s = await call(admin, "GET", "/api/ai/settings");
    expect(s.json().settings.enabled).toBe(false);
    expect(s.json().providers.map((p: { id: string }) => p.id)).toEqual(["openai", "anthropic", "xai", "gemini", "groq"]);
    expect(s.body).not.toMatch(/sk-|xai-|AIza/);
    const r = await call(admin, "POST", `/api/companies/${companyId}/ai-analyses`, {});
    expect(r.statusCode).toBe(400);
  });

  it("valida a configuração antes de salvar", async () => {
    expect((await call(admin, "PUT", "/api/ai/settings", { ...AI, primaryProvider: "openrouter" })).statusCode).toBe(400);
    expect((await call(admin, "PUT", "/api/ai/settings", { ...AI, fallbackProviders: ["openai"] })).statusCode).toBe(400);
    expect((await call(admin, "PUT", "/api/ai/settings", AI)).statusCode).toBe(200);
  });

  it("sem chave cadastrada na conta, recusa antes de chamar e sem registrar cobrança", async () => {
    const r = await call(admin, "POST", `/api/companies/${companyId}/ai-analyses`, {});
    expect(r.statusCode).toBe(422);
    expect(await prisma.aiAnalysis.count()).toBe(0);
  });

  it("estima o custo antes de gerar", async () => {
    setAdapterForTests("openai", fakeProvider("openai"));
    const r = await call(admin, "POST", `/api/companies/${companyId}/ai-analyses/estimate`, {});
    expect(r.statusCode).toBe(200);
    const step = r.json().steps[0];
    expect(step).toMatchObject({ provider: "openai", model: "gpt-6.1-sol", configured: true, blocked: null });
    expect(step.estimate.known).toBe(true);
  });

  it("gera a análise, valida a resposta, descarta fato sem evidência e reaproveita pelo cache", async () => {
    const spy = vi.fn();
    setAdapterForTests("openai", fakeProvider("openai", spy));
    const r = await call(admin, "POST", `/api/companies/${companyId}/ai-analyses`, {});
    expect(r.statusCode).toBe(200);
    const a = r.json();
    expect(a).toMatchObject({ status: "SUCCEEDED", provider: "openai", model: "gpt-6.1-sol", cached: false, recommendedNextAction: { action: "QUALIFY_OPERATION" } });
    expect(a.verifiedFacts).toHaveLength(1);
    expect(a.verifiedFacts[0].evidence[0].id).toBe("E1");
    expect(a.limitations.join(" ")).toMatch(/sem evidência/);
    expect(a.tokenUsage).toEqual({ input: 2000, output: 800, reasoning: null });
    expect(a.estimatedCost.usd).toBeCloseTo((2000 * 2 + 800 * 10) / 1e6, 6);
    // dados sensíveis não vão para o provedor
    expect(spy.mock.calls[0]![0].user).not.toMatch(/3622|99912/);

    const again = await call(admin, "POST", `/api/companies/${companyId}/ai-analyses`, {});
    expect(again.json()).toMatchObject({ id: a.id, cached: true });
    expect(spy).toHaveBeenCalledTimes(1);
    const forced = await call(admin, "POST", `/api/companies/${companyId}/ai-analyses`, { force: true });
    expect(forced.json().cached).toBe(false);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("limite de custo bloqueia modelo caro e modelo sem preço", async () => {
    setAdapterForTests("openai", fakeProvider("openai"));
    const caro = await call(admin, "POST", `/api/companies/${companyId}/ai-analyses`, { provider: "openai", model: "gpt-6-astra" });
    expect(caro.statusCode).toBe(422);
    expect(caro.json().message).toMatch(/acima do limite/);
    const semPreco = await call(admin, "POST", `/api/companies/${companyId}/ai-analyses`, { provider: "openai", model: "modelo-sem-preco" });
    expect(semPreco.statusCode).toBe(422);
    expect(semPreco.json().message).toMatch(/desconhecido/);
  });

  it("alternância automática só usa provedores autorizados e registra a troca", async () => {
    await call(admin, "PUT", "/api/ai/settings", { ...AI, mode: "auto", primaryProvider: "anthropic", fallbackProviders: ["gemini"] });
    setAdapterForTests("anthropic", { ...fakeProvider("anthropic"), generateStructured: async () => Promise.reject(Object.assign(new Error("indisponível"), { status: 503 })) });
    setAdapterForTests("gemini", fakeProvider("gemini"));
    setAdapterForTests("xai", fakeProvider("xai"));
    const r = await call(admin, "POST", `/api/companies/${companyId}/ai-analyses`, { force: true });
    const a = r.json();
    expect(a.provider).toBe("gemini");
    expect(a.attempts.map((x: { provider: string; ok: boolean }) => [x.provider, x.ok])).toEqual([["anthropic", false], ["gemini", true]]);
    expect(a.notes.join(" ")).toMatch(/alternância automática autorizada/);
    await call(admin, "PUT", "/api/ai/settings", AI);
  });

  it("a mensagem pode ser revisada e a sugestão original continua guardada", async () => {
    const list = await call(admin, "GET", `/api/companies/${companyId}/ai-analyses`);
    const id = list.json().find((x: { status: string }) => x.status === "SUCCEEDED").id;
    const r = await call(admin, "PATCH", `/api/ai-analyses/${id}`, { editedMessage: "Olá, tudo bem? Mensagem revisada." });
    expect(r.json()).toMatchObject({ editedMessage: "Olá, tudo bem? Mensagem revisada.", personalizedMessage: OUTPUT.personalizedMessage });
    expect((await call(other, "PATCH", `/api/ai-analyses/${id}`, { editedMessage: "invasão" })).statusCode).toBe(404);
  });

  it("teste de conexão lista modelos sem gerar texto", async () => {
    const spy = vi.fn();
    setAdapterForTests("xai", fakeProvider("xai", spy));
    const r = await call(admin, "POST", "/api/ai/providers/xai/test");
    expect(r.json()).toMatchObject({ ok: true, models: ["modelo-a", "modelo-b"] });
    expect(spy).not.toHaveBeenCalled();
    expect((await call(admin, "POST", "/api/ai/providers/gemini/test")).json()).toMatchObject({ ok: false, code: "NOT_CONFIGURED" });
  });
});

describe("chaves de IA por conta", () => {
  const CHAVE = "gsk_ChaveDaContaAdmin0123456789abcd";
  const seen: string[] = [];
  /** Groq falsa: só aceita CHAVE e registra com qual chave foi chamada. */
  const groqFake = (apiKey: string): AiProviderAdapter => ({
    id: "groq",
    isConfigured: () => !!apiKey,
    listModels: async () => {
      if (apiKey !== CHAVE) throw Object.assign(new Error("Incorrect API key provided"), { status: 401 });
      return ["openai/gpt-oss-120b"];
    },
    generateStructured: async (req) => {
      seen.push(apiKey);
      return fakeProvider("groq").generateStructured(req);
    },
  });
  const groqOf = (body: { providers: { id: string }[] }) => body.providers.find((p) => p.id === "groq");

  it("chave recusada pelo provedor ou malformada não é salva", async () => {
    setAdapterForTests("groq", groqFake);
    const r = await call(admin, "PUT", "/api/ai/credentials/groq", { apiKey: "gsk_errada0123456789" });
    expect(r.statusCode).toBe(422);
    expect(r.json().message).toMatch(/recusada/);
    expect((await call(admin, "PUT", "/api/ai/credentials/groq", { apiKey: "com espaco 0123456789" })).statusCode).toBe(400);
    expect(await prisma.aiCredential.count()).toBe(0);
  });

  it("salva cifrada, mostra só o final e nunca devolve a chave", async () => {
    setAdapterForTests("groq", groqFake);
    const r = await call(admin, "PUT", "/api/ai/credentials/groq", { apiKey: CHAVE });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ hasKey: true, keyHint: "abcd" });
    expect(r.body).not.toContain(CHAVE);
    const row = await prisma.aiCredential.findFirstOrThrow();
    expect(row.encryptedKey.startsWith("v1.")).toBe(true);
    expect(row.encryptedKey).not.toContain("ChaveDaContaAdmin");
    const s = await call(admin, "GET", "/api/ai/settings");
    expect(s.body).not.toContain(CHAVE);
    expect(groqOf(s.json())).toMatchObject({ hasKey: true, keyHint: "abcd", configured: true });
    const audit = await prisma.auditLog.findMany({ where: { action: "ai.credential.saved" } });
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit)).not.toContain("ChaveDaContaAdmin");
  });

  it("outra conta não vê, não usa e não apaga a chave", async () => {
    setAdapterForTests("groq", groqFake);
    expect(groqOf((await call(other, "GET", "/api/ai/settings")).json())).toMatchObject({ hasKey: false, keyHint: null, configured: false });
    expect((await call(other, "POST", "/api/ai/providers/groq/test")).json()).toMatchObject({ ok: false, code: "NOT_CONFIGURED" });
    expect((await call(other, "DELETE", "/api/ai/credentials/groq")).json()).toMatchObject({ removed: false });
    expect(await prisma.aiCredential.count()).toBe(1);
  });

  it("a análise usa a chave da própria conta", async () => {
    setAdapterForTests("groq", groqFake);
    await call(admin, "PUT", "/api/ai/settings", { ...AI, primaryProvider: "groq" });
    const r = await call(admin, "POST", `/api/companies/${companyId}/ai-analyses`, { force: true });
    expect(r.json()).toMatchObject({ status: "SUCCEEDED", provider: "groq" });
    expect(seen).toEqual([CHAVE]);
    await call(admin, "PUT", "/api/ai/settings", AI);
  });

  it("remover apaga a chave e desliga o provedor na conta", async () => {
    setAdapterForTests("groq", groqFake);
    expect((await call(admin, "DELETE", "/api/ai/credentials/groq")).json()).toMatchObject({ removed: true, hasKey: false });
    expect(await prisma.aiCredential.count()).toBe(0);
    expect((await call(admin, "POST", "/api/ai/providers/groq/test")).json()).toMatchObject({ code: "NOT_CONFIGURED" });
  });
});
