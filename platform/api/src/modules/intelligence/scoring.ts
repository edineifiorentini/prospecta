/**
 * Inteligência comercial — três indicadores independentes (metodologia 2026.10-ic1).
 * Documentação: platform/docs/INTELIGENCIA-COMERCIAL.md
 *
 * - Cada critério tem peso configurável e resultado MET (100%), PARTIAL (50%), NOT_MET (0%)
 *   ou NOT_EVALUATED (fora do numerador e do denominador: falta de dado não penaliza).
 * - Nota do indicador = 100 × Σ(peso × crédito) / Σ(peso avaliado).
 * - Cobertura = Σ(peso avaliado) / Σ(peso total). Abaixo da cobertura mínima, a nota fica nula.
 * - Cada critério cita as evidências que usou; dentro de um indicador, uma evidência pontua uma vez só.
 * - Prioridade consolidada: média ponderada dos três indicadores com limites para A e B,
 *   ou "Necessita qualificação" quando faltam dados essenciais.
 */
import type { CompanyFacts, CompanySnapshot } from "./evidence.ts";

export const INTELLIGENCE_METHODOLOGY = "2026.10-ic1";

export type IndicatorId = "FIT" | "OPPORTUNITY" | "RELIABILITY";
export type CriterionResult = "MET" | "PARTIAL" | "NOT_MET" | "NOT_EVALUATED";

export type CriterionDef = { key: string; indicator: IndicatorId; label: string; weight: number };

export const INTELLIGENCE_CRITERIA: CriterionDef[] = [
  { key: "fit.segment", indicator: "FIT", label: "Segmento dentro do perfil de cliente ideal", weight: 30 },
  { key: "fit.whatsapp", indicator: "FIT", label: "WhatsApp comercial divulgado pela empresa", weight: 20 },
  { key: "fit.channels", indicator: "FIT", label: "Presença em outros canais (telefone, e-mail, site, redes)", weight: 20 },
  { key: "fit.movement", indicator: "FIT", label: "Movimento público (volume de avaliações)", weight: 15 },
  { key: "fit.capture", indicator: "FIT", label: "Indícios de captação comercial no site", weight: 15 },

  { key: "opp.whatsapp_lines", indicator: "OPPORTUNITY", label: "Mais de um WhatsApp divulgado", weight: 30 },
  { key: "opp.other_lines", indicator: "OPPORTUNITY", label: "Outras linhas de telefone divulgadas", weight: 20 },
  { key: "opp.written_channels", indicator: "OPPORTUNITY", label: "Canais de mensagem distribuídos (e-mail, Instagram, Facebook)", weight: 15 },
  { key: "opp.entry_points", indicator: "OPPORTUNITY", label: "Entradas diferentes de contatos (formulário, agendamento, pedidos)", weight: 15 },
  { key: "opp.segment_need", indicator: "OPPORTUNITY", label: "Necessidade típica do segmento (hipótese de mercado)", weight: 20 },

  { key: "rel.official", indicator: "RELIABILITY", label: "Contato confirmado no site oficial", weight: 25 },
  { key: "rel.cross_source", indicator: "RELIABILITY", label: "Telefone confirmado por duas fontes", weight: 20 },
  { key: "rel.freshness", indicator: "RELIABILITY", label: "Dados verificados recentemente", weight: 15 },
  { key: "rel.completeness", indicator: "RELIABILITY", label: "Dados essenciais completos", weight: 20 },
  { key: "rel.consistency", indicator: "RELIABILITY", label: "Fontes sem contradições", weight: 10 },
  { key: "rel.collection", indicator: "RELIABILITY", label: "Coleta sem dados inválidos", weight: 10 },
];

export type IntelligenceConfig = {
  targetSegments: string[];
  criteriaWeights: Record<string, number>;
  indicatorWeights: Record<IndicatorId, number>;
  thresholds: { a: number; b: number; minReliability: number; minCoverage: number };
};

export const DEFAULT_INTELLIGENCE_CONFIG: IntelligenceConfig = {
  targetSegments: ["imobiliaria", "contabilidade", "advocacia", "agencia_marketing"],
  criteriaWeights: {},
  indicatorWeights: { FIT: 45, OPPORTUNITY: 35, RELIABILITY: 20 },
  thresholds: { a: 70, b: 50, minReliability: 40, minCoverage: 0.5 },
};

export type CriterionOutcome = {
  key: string;
  label: string;
  weight: number;
  result: CriterionResult;
  points: number;
  justification: string;
  evidenceKeys: string[];
};

export type IndicatorScore = {
  id: IndicatorId;
  score: number | null;
  coverage: number;
  criteria: CriterionOutcome[];
};

export type Priority = "A" | "B" | "C" | "NEEDS_QUALIFICATION";

export type IntelligenceResult = {
  methodology: string;
  computedAt: string;
  indicators: Record<IndicatorId, IndicatorScore>;
  priority: Priority;
  composite: number | null;
  priorityReasons: string[];
};

type Eval = { result: CriterionResult; justification: string; evidenceKeys?: string[] };
const met = (justification: string, evidenceKeys: string[] = []): Eval => ({ result: "MET", justification, evidenceKeys });
const partial = (justification: string, evidenceKeys: string[] = []): Eval => ({ result: "PARTIAL", justification, evidenceKeys });
const notMet = (justification: string, evidenceKeys: string[] = []): Eval => ({ result: "NOT_MET", justification, evidenceKeys });
const na = (justification: string): Eval => ({ result: "NOT_EVALUATED", justification, evidenceKeys: [] });
const CREDIT: Record<CriterionResult, number | null> = { MET: 1, PARTIAL: 0.5, NOT_MET: 0, NOT_EVALUATED: null };
const DAY = 86_400_000;

function evaluateCriteria(c: CompanySnapshot, f: CompanyFacts, cfg: IntelligenceConfig, now: Date): Record<string, Eval> {
  const out: Record<string, Eval> = {};
  const siteRead = f.website.state === "REACHABLE";
  const wa = f.phones.phones.filter((p) => p.whatsapp === "CONFIRMED");
  const otherLines = f.phones.phones.filter((p) => p.whatsapp !== "CONFIRMED");
  const phoneKeys = (list: typeof wa) => list.map((p) => `phone:${p.e164}`);
  const socialKeys = f.socials.map((s) => `social:${s.network}`);
  const has = (key: string) => f.evidence.some((e) => e.key === key);

  // ── Aderência ao perfil ──
  if (!f.segment) out["fit.segment"] = c.category ? notMet(`A categoria "${c.category}" não corresponde a nenhum segmento cadastrado.`) : na("Sem categoria para identificar o segmento.");
  else if (cfg.targetSegments.includes(f.segment.segment.id)) out["fit.segment"] = met(`${f.segment.segment.label}: segmento-alvo.`, ["segment"]);
  else out["fit.segment"] = notMet(`${f.segment.segment.label} não está entre os segmentos-alvo da conta.`, ["segment"]);

  if (wa.length) out["fit.whatsapp"] = met(`${wa.length} WhatsApp confirmado(s) (link publicado no site oficial ou registro manual).`, phoneKeys(wa));
  else if (siteRead) out["fit.whatsapp"] = notMet("O site foi lido e não divulga link de WhatsApp. Celular não conta como WhatsApp.", ["website"]);
  else out["fit.whatsapp"] = na("Sem site lido para confirmar WhatsApp. Celular sozinho não comprova WhatsApp.");

  const channels = [
    otherLines.length > 0 && "telefone",
    f.emails.length > 0 && "e-mail",
    siteRead && "site",
    f.socials.length > 0 && "redes sociais",
  ].filter((x): x is string => !!x);
  const channelKeys = [...phoneKeys(otherLines), ...(f.emails.length ? ["email"] : []), ...(siteRead ? ["website"] : []), ...socialKeys];
  out["fit.channels"] =
    channels.length >= 3 ? met(`Canais: ${channels.join(", ")}.`, channelKeys) : channels.length >= 1 ? partial(`Canais: ${channels.join(", ")}.`, channelKeys) : notMet("Nenhum outro canal encontrado nas fontes consultadas.");

  if (c.reviewCount == null) out["fit.movement"] = na("Quantidade de avaliações não disponível.");
  else if (c.reviewCount >= 30) out["fit.movement"] = met(`${c.reviewCount} avaliações públicas (indica movimento, não tamanho de equipe).`, ["gbp.reviews"]);
  else if (c.reviewCount >= 10) out["fit.movement"] = partial(`${c.reviewCount} avaliações públicas.`, ["gbp.reviews"]);
  else out["fit.movement"] = notMet(`${c.reviewCount} avaliações públicas.`, ["gbp.reviews"]);

  if (has("audit.cta")) out["fit.capture"] = met("A auditoria encontrou chamada para ação comercial no site.", ["audit.cta"]);
  else if (siteRead && c.auditSignals) out["fit.capture"] = notMet("A auditoria do site não encontrou chamada para ação comercial.", ["website"]);
  else out["fit.capture"] = na("Sem auditoria do site para observar a captação comercial.");

  // ── Oportunidade comercial ──
  if (wa.length >= 2) out["opp.whatsapp_lines"] = met(`${wa.length} números de WhatsApp divulgados: pode indicar atendimento distribuído (a confirmar na conversa).`, phoneKeys(wa));
  else if (wa.length === 1) out["opp.whatsapp_lines"] = partial("Um WhatsApp divulgado. Não se sabe quantas pessoas atendem por ele.", phoneKeys(wa));
  else if (siteRead) out["opp.whatsapp_lines"] = notMet("Nenhum WhatsApp divulgado no site.", ["website"]);
  else out["opp.whatsapp_lines"] = na("Sem fonte para confirmar WhatsApp.");

  if (!f.phones.phones.length && !c.contacts.length) out["opp.other_lines"] = na("Nenhum telefone coletado.");
  else if (otherLines.length >= 2) out["opp.other_lines"] = met(`${otherLines.length} outras linhas divulgadas. Vários números não provam desorganização.`, phoneKeys(otherLines));
  else if (otherLines.length === 1) out["opp.other_lines"] = partial("Uma outra linha divulgada.", phoneKeys(otherLines));
  else out["opp.other_lines"] = notMet("Nenhuma outra linha além do WhatsApp.");

  const written = [f.emails.length > 0 && "e-mail", f.socials.some((s) => s.network === "INSTAGRAM") && "Instagram", f.socials.some((s) => s.network === "FACEBOOK") && "Facebook"].filter(
    (x): x is string => !!x,
  );
  const writtenKeys = [...(f.emails.length ? ["email"] : []), ...socialKeys.filter((k) => k === "social:INSTAGRAM" || k === "social:FACEBOOK")];
  if (!written.length && !siteRead && !c.hasGoogleSource) out["opp.written_channels"] = na("Fontes insuficientes.");
  else out["opp.written_channels"] = written.length >= 2 ? met(`Mensagens podem chegar por ${written.join(", ")} além do telefone.`, writtenKeys) : written.length === 1 ? partial(`Também recebe mensagens por ${written[0]}.`, writtenKeys) : notMet("Nenhum canal de mensagem além do telefone.");

  const entries = [["audit.contact_page", "página de contato"], ["audit.contact_buttons", "botões de contato"], ["gbp.reservations", "agendamento pelo Google"], ["gbp.order", "pedidos on-line"]].filter(([k]) => has(k!));
  if (!entries.length && !c.auditSignals && !c.hasGoogleSource) out["opp.entry_points"] = na("Sem auditoria do site nem ficha do Google para observar as entradas de contato.");
  else if (entries.length >= 2) out["opp.entry_points"] = met(`Entradas: ${entries.map((e) => e[1]).join(", ")}.`, entries.map((e) => e[0]!));
  else if (entries.length === 1) out["opp.entry_points"] = partial(`Entrada: ${entries[0]![1]}.`, [entries[0]![0]!]);
  else if (!c.auditSignals) out["opp.entry_points"] = na("Sem auditoria do site para observar formulários e botões de contato.");
  else out["opp.entry_points"] = notMet("Nenhuma entrada de contato além do telefone foi observada.");

  out["opp.segment_need"] = f.segment
    ? partial(`Hipótese de mercado para ${f.segment.segment.label.toLowerCase()}: ${f.segment.segment.painHypotheses[0]!.toLowerCase()}. Precisa ser confirmada.`, ["segment"])
    : na("Segmento não identificado.");

  // ── Confiabilidade dos dados ──
  const fromSite = f.phones.phones.filter((p) => p.origins.some((o) => o.source === "WEBSITE"));
  const emailFromSite = f.emails.some((e) => e.source === "WEBSITE");
  if (fromSite.length || emailFromSite) out["rel.official"] = met("Contato publicado no site oficial.", [...phoneKeys(fromSite), ...(emailFromSite ? ["email"] : [])]);
  else if (siteRead) out["rel.official"] = notMet("O site foi lido, mas nenhum contato coletado aparece nele.", ["website"]);
  else out["rel.official"] = na("Site indisponível, bloqueado ou inexistente: confirmação não foi possível (sem penalidade).");

  const cross = f.phones.phones.filter((p) => p.sourceCount >= 2);
  if (cross.length) out["rel.cross_source"] = met(`${cross.length} telefone(s) aparece(m) em duas fontes ou mais.`, cross.map((p) => `cross:${p.e164}`));
  else if (f.phones.phones.length) out["rel.cross_source"] = notMet("Cada telefone vem de uma única fonte.");
  else out["rel.cross_source"] = na("Sem telefone para comparar.");

  if (!f.lastVerification) out["rel.freshness"] = na("Data de coleta desconhecida.");
  else {
    const days = Math.floor((now.getTime() - new Date(f.lastVerification).getTime()) / DAY);
    const when = days <= 0 ? "hoje" : days === 1 ? "há 1 dia" : `há ${days} dias`;
    out["rel.freshness"] = days <= 90 ? met(`Verificado ${when}.`) : days <= 365 ? partial(`Verificado ${when}.`) : notMet(`Última verificação ${when}.`);
  }

  const essentials = [["categoria", !!c.category], ["cidade", !!c.city], ["contato válido", f.phones.phones.length > 0 || f.emails.length > 0], ["endereço ou ficha pública", !!c.address || !!c.sourceUrl]] as const;
  const present = essentials.filter((e) => e[1]).length;
  const missing = essentials.filter((e) => !e[1]).map((e) => e[0]);
  out["rel.completeness"] = present === 4 ? met("Categoria, cidade, contato e localização presentes.") : present === 3 ? partial(`Falta: ${missing.join(", ")}.`) : notMet(`Faltam: ${missing.join(", ")}.`);

  out["rel.consistency"] = f.contradictions.length ? notMet(`Fontes discordam sobre: ${f.contradictions.map((k) => k.field).join(", ")}.`) : met("Nenhuma contradição entre as fontes.");

  const collectionProblems = [f.phones.rejected.length && `${f.phones.rejected.length} telefone(s) inválido(s)`, f.website.state === "INVALID_URL" && "endereço de site inválido"].filter(Boolean);
  out["rel.collection"] = collectionProblems.length >= 2 ? notMet(`Problemas: ${collectionProblems.join("; ")}.`) : collectionProblems.length === 1 ? partial(`Problema: ${collectionProblems[0]}.`) : met("Nenhum dado inválido nas fontes.");

  return out;
}

const normalizeWeights = (w: Record<IndicatorId, number>) => {
  const total = w.FIT + w.OPPORTUNITY + w.RELIABILITY;
  return total > 0 ? { FIT: w.FIT / total, OPPORTUNITY: w.OPPORTUNITY / total, RELIABILITY: w.RELIABILITY / total } : { FIT: 1 / 3, OPPORTUNITY: 1 / 3, RELIABILITY: 1 / 3 };
};

export function scoreCompany(c: CompanySnapshot, f: CompanyFacts, cfg: IntelligenceConfig = DEFAULT_INTELLIGENCE_CONFIG, now = new Date()): IntelligenceResult {
  const evals = evaluateCriteria(c, f, cfg, now);
  const indicators = {} as Record<IndicatorId, IndicatorScore>;
  for (const id of ["FIT", "OPPORTUNITY", "RELIABILITY"] as IndicatorId[]) {
    let total = 0;
    let evaluated = 0;
    let earned = 0;
    const used = new Set<string>();
    const criteria: CriterionOutcome[] = [];
    for (const def of INTELLIGENCE_CRITERIA.filter((d) => d.indicator === id)) {
      const weight = cfg.criteriaWeights[def.key] ?? def.weight;
      const e = evals[def.key] ?? na("Critério não avaliado.");
      // evidência já usada por outro critério do mesmo indicador não pontua de novo
      const keys = (e.evidenceKeys ?? []).filter((k) => !used.has(k));
      const reused = (e.evidenceKeys?.length ?? 0) > 0 && keys.length === 0;
      const result: CriterionResult = reused ? "NOT_EVALUATED" : e.result;
      keys.forEach((k) => used.add(k));
      total += weight;
      const credit = CREDIT[result];
      if (credit != null) {
        evaluated += weight;
        earned += weight * credit;
      }
      criteria.push({ key: def.key, label: def.label, weight, result, points: credit == null ? 0 : Math.round(weight * credit * 10) / 10, justification: reused ? "Evidência já considerada em outro critério deste indicador." : e.justification, evidenceKeys: keys });
    }
    const coverage = total > 0 ? Math.round((evaluated / total) * 100) / 100 : 0;
    indicators[id] = { id, score: evaluated > 0 && coverage >= cfg.thresholds.minCoverage ? Math.round((100 * earned) / evaluated) : null, coverage, criteria };
  }

  const reasons: string[] = [];
  const names: Record<IndicatorId, string> = { FIT: "aderência", OPPORTUNITY: "oportunidade", RELIABILITY: "confiabilidade" };
  for (const id of ["FIT", "OPPORTUNITY", "RELIABILITY"] as IndicatorId[]) if (indicators[id].score == null) reasons.push(`Dados insuficientes para avaliar ${names[id]}.`);
  if (!f.phones.phones.length && !f.emails.length) reasons.push("Nenhum contato válido.");
  const rel = indicators.RELIABILITY.score;
  if (rel != null && rel < cfg.thresholds.minReliability) reasons.push(`Confiabilidade ${rel} abaixo do mínimo (${cfg.thresholds.minReliability}).`);

  let composite: number | null = null;
  let priority: Priority = "NEEDS_QUALIFICATION";
  if (!reasons.length) {
    const w = normalizeWeights(cfg.indicatorWeights);
    composite = Math.round(w.FIT * indicators.FIT.score! + w.OPPORTUNITY * indicators.OPPORTUNITY.score! + w.RELIABILITY * indicators.RELIABILITY.score!);
    priority = composite >= cfg.thresholds.a ? "A" : composite >= cfg.thresholds.b ? "B" : "C";
    reasons.push(`Média ponderada ${composite} (A a partir de ${cfg.thresholds.a}, B a partir de ${cfg.thresholds.b}).`);
  }
  return { methodology: INTELLIGENCE_METHODOLOGY, computedAt: now.toISOString(), indicators, priority, composite, priorityReasons: reasons };
}
