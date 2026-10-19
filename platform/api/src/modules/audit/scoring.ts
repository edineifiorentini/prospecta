/**
 * Metodologia de pontuação (versão 2026.10-1) — documentada em platform/docs/METODOLOGIA-PONTUACAO.md.
 *
 * - Cada dimensão tem critérios independentes com peso configurável (0–100).
 * - Resultado de cada critério: PASS (100% do peso), WARN (50%), FAIL (0%),
 *   NOT_EVALUATED (fora do numerador E do denominador) ou INFO (só registro).
 * - Pontuação = 100 × Σ(peso × crédito) / Σ(peso dos critérios avaliados).
 * - Confiança = Σ(peso avaliado) / Σ(peso total da dimensão).
 * - Se a confiança for menor que 30%, a dimensão fica "Não avaliado" (score null).
 * - Na dimensão OPORTUNIDADE, PASS significa "oportunidade identificada com evidência".
 */
import type { EvidenceResult, ScoreKind } from "../../lib/prisma.ts";

export const METHODOLOGY_VERSION = "2026.10-1";
export const MIN_CONFIDENCE = 0.3;

export type CriterionDef = { key: string; dimension: ScoreKind; label: string; weight: number };

export const CRITERIA: CriterionDef[] = [
  // Qualidade e completude dos dados do lead
  { key: "dq.name", dimension: "DATA_QUALITY", label: "Nome comercial identificado", weight: 5 },
  { key: "dq.category", dimension: "DATA_QUALITY", label: "Categoria/segmento", weight: 5 },
  { key: "dq.address", dimension: "DATA_QUALITY", label: "Endereço completo", weight: 10 },
  { key: "dq.city", dimension: "DATA_QUALITY", label: "Cidade confirmada pela fonte", weight: 5 },
  { key: "dq.phone", dimension: "DATA_QUALITY", label: "Telefone válido (E.164)", weight: 15 },
  { key: "dq.phone_verified", dimension: "DATA_QUALITY", label: "Telefone confirmado por duas fontes", weight: 5 },
  { key: "dq.email", dimension: "DATA_QUALITY", label: "E-mail comercial", weight: 15 },
  { key: "dq.email_mx", dimension: "DATA_QUALITY", label: "Domínio do e-mail aceita mensagens (MX)", weight: 5 },
  { key: "dq.website", dimension: "DATA_QUALITY", label: "Site informado e acessível", weight: 10 },
  { key: "dq.social", dimension: "DATA_QUALITY", label: "Rede social com vínculo confirmado", weight: 10 },
  { key: "dq.legal_id", dimension: "DATA_QUALITY", label: "CNPJ identificado", weight: 5 },
  { key: "dq.freshness", dimension: "DATA_QUALITY", label: "Dados verificados recentemente", weight: 10 },

  // Presença pública no Google (somente dados públicos acessíveis)
  { key: "gbp.listing", dimension: "GOOGLE_PRESENCE", label: "Ficha pública encontrada no Google Maps", weight: 10 },
  { key: "gbp.category", dimension: "GOOGLE_PRESENCE", label: "Categoria definida na ficha", weight: 10 },
  { key: "gbp.address", dimension: "GOOGLE_PRESENCE", label: "Endereço na ficha", weight: 10 },
  { key: "gbp.phone", dimension: "GOOGLE_PRESENCE", label: "Telefone na ficha", weight: 15 },
  { key: "gbp.website", dimension: "GOOGLE_PRESENCE", label: "Site vinculado à ficha", weight: 15 },
  { key: "gbp.hours", dimension: "GOOGLE_PRESENCE", label: "Horário de funcionamento publicado", weight: 10 },
  { key: "gbp.reviews", dimension: "GOOGLE_PRESENCE", label: "Volume de avaliações públicas", weight: 15 },
  { key: "gbp.rating", dimension: "GOOGLE_PRESENCE", label: "Nota média pública", weight: 10 },
  { key: "gbp.description", dimension: "GOOGLE_PRESENCE", label: "Descrição da empresa na ficha", weight: 5 },
  { key: "gbp.photos", dimension: "GOOGLE_PRESENCE", label: "Fotos visíveis na ficha", weight: 5 },

  // Qualidade técnica do website
  { key: "site.reachable", dimension: "WEBSITE_QUALITY", label: "Site no ar", weight: 15 },
  { key: "site.https", dimension: "WEBSITE_QUALITY", label: "HTTPS ativo e forçado", weight: 10 },
  { key: "site.mobile", dimension: "WEBSITE_QUALITY", label: "Preparado para celular (viewport)", weight: 8 },
  { key: "site.performance", dimension: "WEBSITE_QUALITY", label: "Velocidade de carregamento", weight: 12 },
  { key: "site.title", dimension: "WEBSITE_QUALITY", label: "Título da página adequado", weight: 5 },
  { key: "site.meta_description", dimension: "WEBSITE_QUALITY", label: "Meta description", weight: 5 },
  { key: "site.h1", dimension: "WEBSITE_QUALITY", label: "Hierarquia H1", weight: 5 },
  { key: "site.h2", dimension: "WEBSITE_QUALITY", label: "Subtítulos H2", weight: 3 },
  { key: "site.broken_links", dimension: "WEBSITE_QUALITY", label: "Links internos funcionando", weight: 6 },
  { key: "site.contact_page", dimension: "WEBSITE_QUALITY", label: "Página de contato", weight: 6 },
  { key: "site.contact_buttons", dimension: "WEBSITE_QUALITY", label: "Botões de contato (telefone, WhatsApp, e-mail, formulário)", weight: 6 },
  { key: "site.cta", dimension: "WEBSITE_QUALITY", label: "Chamada para ação comercial", weight: 4 },
  { key: "site.seo", dimension: "WEBSITE_QUALITY", label: "SEO básico (Lighthouse)", weight: 4 },
  { key: "site.open_graph", dimension: "WEBSITE_QUALITY", label: "Open Graph para compartilhamento", weight: 3 },
  { key: "site.sitemap", dimension: "WEBSITE_QUALITY", label: "Sitemap XML", weight: 3 },
  { key: "site.robots", dimension: "WEBSITE_QUALITY", label: "robots.txt", weight: 3 },
  { key: "site.structured_data", dimension: "WEBSITE_QUALITY", label: "Dados estruturados (Schema.org)", weight: 5 },
  { key: "site.social_links", dimension: "WEBSITE_QUALITY", label: "Links para redes sociais", weight: 4 },
  { key: "site.accessibility", dimension: "WEBSITE_QUALITY", label: "Acessibilidade básica", weight: 4 },
  { key: "site.lang", dimension: "WEBSITE_QUALITY", label: "Idioma declarado", weight: 2 },

  // Presença digital multicanal
  { key: "mc.website", dimension: "MULTICHANNEL", label: "Site próprio ativo", weight: 20 },
  { key: "mc.google", dimension: "MULTICHANNEL", label: "Ficha no Google Maps", weight: 10 },
  { key: "mc.instagram", dimension: "MULTICHANNEL", label: "Instagram", weight: 15 },
  { key: "mc.facebook", dimension: "MULTICHANNEL", label: "Facebook", weight: 10 },
  { key: "mc.linkedin", dimension: "MULTICHANNEL", label: "LinkedIn", weight: 8 },
  { key: "mc.video", dimension: "MULTICHANNEL", label: "YouTube ou TikTok", weight: 5 },
  { key: "mc.whatsapp", dimension: "MULTICHANNEL", label: "WhatsApp divulgado", weight: 15 },
  { key: "mc.email", dimension: "MULTICHANNEL", label: "E-mail comercial publicado", weight: 12 },
  { key: "mc.consistency", dimension: "MULTICHANNEL", label: "Coerência entre marca, domínio e perfis", weight: 5 },

  // Oportunidade comercial (PASS = oportunidade identificada com evidência)
  { key: "op.website", dimension: "OPPORTUNITY", label: "Sem site próprio ou site fora do ar", weight: 25 },
  { key: "op.https", dimension: "OPPORTUNITY", label: "Site sem HTTPS forçado", weight: 10 },
  { key: "op.performance", dimension: "OPPORTUNITY", label: "Site lento", weight: 10 },
  { key: "op.seo", dimension: "OPPORTUNITY", label: "Falhas de SEO básico", weight: 10 },
  { key: "op.social", dimension: "OPPORTUNITY", label: "Sem Instagram/Facebook vinculado", weight: 10 },
  { key: "op.reviews", dimension: "OPPORTUNITY", label: "Poucas avaliações ou nota baixa", weight: 10 },
  { key: "op.gbp", dimension: "OPPORTUNITY", label: "Ficha do Google incompleta", weight: 10 },
  { key: "op.contactable", dimension: "OPPORTUNITY", label: "Canal de contato comercial disponível", weight: 15 },
];

export type Evaluation = {
  key: string;
  result: EvidenceResult;
  value?: unknown;
  detail?: string;
  url?: string | null;
};

export type DimensionScore = { score: number | null; confidence: number; evaluated: number; total: number; passed: number; failed: number; warned: number };

const CREDIT: Partial<Record<EvidenceResult, number>> = { PASS: 1, WARN: 0.5, FAIL: 0 };

/** Pesos efetivos: padrão sobrescrito pelas configurações da organização (settings.scoring[dimensão][critério]). */
export function effectiveWeights(overrides: Record<string, Record<string, number>> = {}) {
  const map = new Map<string, number>();
  for (const c of CRITERIA) map.set(c.key, overrides[c.dimension]?.[c.key] ?? c.weight);
  return map;
}

export function computeScores(evals: Evaluation[], weights = effectiveWeights()): Record<ScoreKind, DimensionScore> {
  const out = {} as Record<ScoreKind, DimensionScore>;
  const byKey = new Map(evals.map((e) => [e.key, e]));
  for (const dim of ["DATA_QUALITY", "GOOGLE_PRESENCE", "WEBSITE_QUALITY", "MULTICHANNEL", "OPPORTUNITY"] as ScoreKind[]) {
    let total = 0;
    let evaluated = 0;
    let earned = 0;
    let passed = 0;
    let failed = 0;
    let warned = 0;
    for (const c of CRITERIA.filter((x) => x.dimension === dim)) {
      const w = weights.get(c.key) ?? c.weight;
      total += w;
      const e = byKey.get(c.key);
      const credit = e ? CREDIT[e.result] : undefined;
      if (credit === undefined) continue;
      evaluated += w;
      earned += w * credit;
      if (e!.result === "PASS") passed++;
      else if (e!.result === "FAIL") failed++;
      else warned++;
    }
    const confidence = total > 0 ? evaluated / total : 0;
    out[dim] = {
      score: evaluated > 0 && confidence >= MIN_CONFIDENCE ? Math.round((100 * earned) / evaluated) : null,
      confidence: Math.round(confidence * 100) / 100,
      evaluated,
      total,
      passed,
      failed,
      warned,
    };
  }
  return out;
}

export const criterion = (key: string) => CRITERIA.find((c) => c.key === key)!;
