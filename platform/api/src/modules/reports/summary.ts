import { esc } from "../audit/pdf.ts";
import { TZ, type DashboardMetrics } from "./metrics.ts";

const DIM: Record<string, string> = {
  DATA_QUALITY: "Qualidade dos dados",
  GOOGLE_PRESENCE: "Presença no Google",
  WEBSITE_QUALITY: "Qualidade do site",
  MULTICHANNEL: "Presença multicanal",
  OPPORTUNITY: "Oportunidade comercial",
};

const n = (v: number) => new Intl.NumberFormat("pt-BR").format(v);
const brl = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(cents / 100);
const pct = (v: number | null) => (v == null ? "sem fechamentos" : `${Math.round(v * 100)}%`);
const day = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { timeZone: TZ });

type Row = { group: string; label: string; value: string; definition: string };

/** Indicadores em linhas (CSV e PDF usam a mesma fonte e as mesmas definições). */
export function summaryRows(m: DashboardMetrics): Row[] {
  const p = `${day(m.period.from)} a ${day(m.period.to)}`;
  const rows: Row[] = [
    { group: "Período", label: "Intervalo", value: p, definition: `Fluxos contados nesse intervalo (fuso ${m.period.timezone})` },
    ...(m.filters.city ? [{ group: "Período", label: "Cidade", value: m.filters.city, definition: "Filtro aplicado" }] : []),
    ...(m.filters.category ? [{ group: "Período", label: "Segmento", value: m.filters.category, definition: "Filtro aplicado" }] : []),
    { group: "Leads", label: "Empresas ativas", value: n(m.leads.total), definition: "Situação atual: empresas não arquivadas" },
    { group: "Leads", label: "Novos leads no período", value: n(m.leads.newInPeriod), definition: "Empresas cadastradas no período (busca, importação ou manual)" },
    { group: "Leads", label: "Leads qualificados", value: n(m.leads.qualified), definition: "Empresas com negociação aberta ou ganha que já passaram da primeira etapa do funil" },
    { group: "Leads", label: "Sem site", value: n(m.leads.withoutWebsite), definition: "Empresas ativas sem site informado ou encontrado" },
    { group: "Leads", label: "Sem nenhum contato", value: n(m.leads.withoutContact), definition: "Sem telefone nem e-mail válido registrado" },
    { group: "Leads", label: "Dados incompletos", value: n(m.leads.incompleteData), definition: "Pontuação de qualidade dos dados abaixo de 60" },
    { group: "Leads", label: "Alta oportunidade", value: n(m.leads.highOpportunity), definition: "Pontuação de oportunidade comercial a partir de 60 (lacunas com evidência)" },
    { group: "Funil", label: "Negociações abertas", value: n(m.pipeline.openDeals), definition: "Situação atual" },
    { group: "Funil", label: "Valor em aberto", value: brl(m.pipeline.openValueCents), definition: "Soma dos valores estimados informados nas negociações abertas" },
    { group: "Funil", label: "Negociações criadas", value: n(m.pipeline.dealsCreated), definition: "Criadas no período" },
    { group: "Funil", label: "Ganhas no período", value: n(m.pipeline.wonInPeriod), definition: "Fechadas como ganhas no período" },
    { group: "Funil", label: "Valor ganho", value: brl(m.pipeline.wonValueCents), definition: "Soma dos valores das negociações ganhas no período" },
    { group: "Funil", label: "Perdidas no período", value: n(m.pipeline.lostInPeriod), definition: "Fechadas como perdidas no período" },
    { group: "Funil", label: "Taxa de conversão", value: pct(m.pipeline.winRate), definition: "Ganhas ÷ (ganhas + perdidas) fechadas no período" },
    ...m.pipeline.stages.map((s) => ({ group: "Funil por etapa", label: s.name, value: `${n(s.count)} · ${brl(s.valueCents)}`, definition: "Negociações atualmente na etapa" })),
    { group: "Atividade", label: "Contatos realizados", value: n(m.activity.contacts.total), definition: "Ligações, reuniões e e-mails registrados + mensagens de WhatsApp enviadas" },
    { group: "Atividade", label: "Ligações", value: n(m.activity.contacts.calls), definition: "Registradas no período" },
    { group: "Atividade", label: "Reuniões", value: n(m.activity.contacts.meetings), definition: "Registradas no período" },
    { group: "Atividade", label: "E-mails", value: n(m.activity.contacts.emails), definition: "Registrados no período" },
    { group: "Atividade", label: "WhatsApp enviadas", value: n(m.activity.contacts.whatsappSent), definition: "Mensagens com envio confirmado pelo provedor" },
    { group: "Atividade", label: "WhatsApp recebidas", value: n(m.activity.whatsappReceived), definition: "Mensagens recebidas no período" },
    { group: "Atividade", label: "Tarefas pendentes", value: n(m.activity.tasks.open), definition: "Situação atual" },
    { group: "Atividade", label: "Tarefas atrasadas", value: n(m.activity.tasks.overdue), definition: "Pendentes com prazo vencido" },
    { group: "Atividade", label: "Tarefas concluídas", value: n(m.activity.tasks.doneInPeriod), definition: "Concluídas no período" },
    { group: "Atividade", label: "Buscas realizadas", value: n(m.activity.searches.count), definition: `${n(m.activity.searches.newCompanies)} empresas novas de ${n(m.activity.searches.results)} resultados` },
    { group: "Atividade", label: "Auditorias concluídas", value: n(m.activity.auditsCompleted), definition: "Concluídas no período" },
    ...m.segments.byCity.map((c) => ({ group: "Por cidade", label: c.label, value: n(c.count), definition: "Empresas ativas" })),
    ...m.segments.byCategory.map((c) => ({ group: "Por segmento", label: c.label, value: n(c.count), definition: "Empresas ativas" })),
  ];
  for (const [kind, d] of Object.entries(m.scores)) {
    rows.push(...d.buckets.map((b) => ({ group: `Distribuição — ${DIM[kind]}`, label: b.label, value: n(b.count), definition: "Empresas na faixa de pontuação" })));
    rows.push({ group: `Distribuição — ${DIM[kind]}`, label: "Não avaliado", value: n(d.notEvaluated), definition: "Sem evidência suficiente para pontuar (não entra nas faixas)" });
  }
  return rows;
}

/** HTML do resumo para PDF (todo conteúdo dinâmico é escapado). */
export function renderDashboardHtml(orgName: string, m: DashboardMetrics) {
  const rows = summaryRows(m);
  const groups = [...new Set(rows.map((r) => r.group))];
  const kpi = (label: string, value: string, hint: string) => `<div class="kpi"><div class="kv">${esc(value)}</div><div class="kl">${esc(label)}</div><div class="kh">${esc(hint)}</div></div>`;
  const generated = new Date().toLocaleString("pt-BR", { timeZone: TZ });
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Resumo de indicadores — ${esc(orgName)}</title>
<style>
  @page { size: A4; margin: 16mm 14mm 18mm; }
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", Inter, Arial, sans-serif; color: #1f2430; font-size: 10pt; line-height: 1.45; margin: 0; }
  h1 { font-size: 19pt; margin: 0 0 2px; letter-spacing: -0.02em; }
  h2 { font-size: 11.5pt; margin: 18px 0 6px; padding-bottom: 4px; border-bottom: 2px solid #16a34a22; break-after: avoid; }
  .muted { color: #6b7280; }
  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-top: 14px; }
  .kpi { border: 1px solid #e5e7eb; border-radius: 10px; padding: 10px 12px; }
  .kv { font-size: 15pt; font-weight: 650; font-variant-numeric: tabular-nums; }
  .kl { font-size: 8.5pt; font-weight: 600; margin-top: 2px; }
  .kh { font-size: 7.5pt; color: #6b7280; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 4px 6px; border-bottom: 1px solid #f0f1f3; vertical-align: top; }
  td.v { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; font-weight: 600; width: 26%; }
  td.d { color: #6b7280; font-size: 8.5pt; width: 44%; }
  section { break-inside: avoid; }
  .note { margin-top: 18px; font-size: 8pt; color: #6b7280; border-top: 1px solid #e5e7eb; padding-top: 8px; }
</style></head><body>
<h1>Resumo de indicadores</h1>
<div class="muted">${esc(orgName)} · ${esc(rows[0]?.value ?? "")} · gerado em ${esc(generated)}</div>
<div class="kpis">
  ${kpi("Novos leads", n(m.leads.newInPeriod), "no período")}
  ${kpi("Contatos realizados", n(m.activity.contacts.total), "no período")}
  ${kpi("Negociações abertas", n(m.pipeline.openDeals), brl(m.pipeline.openValueCents))}
  ${kpi("Conversão", pct(m.pipeline.winRate), `${n(m.pipeline.wonInPeriod)} ganhas · ${n(m.pipeline.lostInPeriod)} perdidas`)}
</div>
${groups
  .filter((g) => g !== "Período")
  .map((g) => `<section><h2>${esc(g)}</h2><table>${rows.filter((r) => r.group === g).map((r) => `<tr><td>${esc(r.label)}</td><td class="v">${esc(r.value)}</td><td class="d">${esc(r.definition)}</td></tr>`).join("")}</table></section>`)
  .join("")}
<p class="note">Todos os números vêm dos registros da plataforma no momento da geração. Pontuações seguem a metodologia interna documentada e não são avaliações oficiais do Google. Itens "Não avaliado" não tinham evidência suficiente.</p>
</body></html>`;
}
