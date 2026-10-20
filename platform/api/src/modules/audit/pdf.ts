import { existsSync } from "node:fs";
import { unavailable } from "../../lib/errors.ts";
import { logger } from "../../lib/logger.ts";

export const esc = (v: unknown) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const DIM: Record<string, string> = {
  DATA_QUALITY: "Qualidade dos dados",
  GOOGLE_PRESENCE: "Presença no Google",
  WEBSITE_QUALITY: "Qualidade do site",
  MULTICHANNEL: "Presença multicanal",
  OPPORTUNITY: "Oportunidade comercial",
};
const RESULT: Record<string, string> = { PASS: "Atende", FAIL: "Não atende", WARN: "Parcial", INFO: "Info", NOT_EVALUATED: "Não avaliado" };

export type ReportInput = {
  organizationName: string;
  company: { name: string; category: string | null; city: string | null; state: string | null; website: string | null; sourceUrl: string | null };
  audit: {
    id: string;
    finishedAt: Date | null;
    methodologyVersion: string;
    scores: Record<string, { score: number | null; confidence: number }>;
    summary: string | null;
    positives: { label: string; detail: string | null; url: string | null }[];
    problems: { label: string; detail: string | null; url: string | null; severity: string }[];
    recommendations: { title: string; action: string; impact: string; priority: number; evidence: string | null }[];
    services: { name: string; reason: string }[];
    lighthouse: Record<string, unknown> | null;
  };
  evidence: { dimension: string; label: string; result: string; detail: string | null; url: string | null; observedAt: Date }[];
};

const tone = (s: number | null) => (s == null ? "#9aa1ac" : s >= 70 ? "#16a34a" : s >= 40 ? "#d97706" : "#dc2626");

/** HTML do relatório (todo conteúdo dinâmico é escapado). */
export function renderReportHtml(r: ReportInput) {
  const date = (r.audit.finishedAt ?? new Date()).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const scoreCards = Object.entries(DIM)
    .map(([k, label]) => {
      const s = r.audit.scores[k];
      return `<div class="score"><div class="sv" style="color:${k === "OPPORTUNITY" ? (s?.score == null ? "#9aa1ac" : "#2563eb") : tone(s?.score ?? null)}">${s?.score ?? "N/A"}</div><div class="sl">${esc(label)}</div><div class="sc">${s?.score == null ? "Não avaliado" : `Confiança ${Math.round((s?.confidence ?? 0) * 100)}%`}</div></div>`;
    })
    .join("");
  const link = (u: string | null) => (u ? ` <a href="${esc(u)}">${esc(u.length > 70 ? `${u.slice(0, 70)}…` : u)}</a>` : "");
  const lh = r.audit.lighthouse as Record<string, number | null> | null;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Relatório — ${esc(r.company.name)}</title>
<style>
  @page { size: A4; margin: 16mm 14mm 18mm; }
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", Inter, Arial, sans-serif; color: #1f2430; font-size: 10.5pt; line-height: 1.45; margin: 0; }
  h1 { font-size: 20pt; margin: 0 0 2px; letter-spacing: -0.02em; }
  h2 { font-size: 12.5pt; margin: 22px 0 8px; padding-bottom: 4px; border-bottom: 2px solid #16a34a22; }
  .muted { color: #6b7280; }
  .brand { display:flex; justify-content:space-between; align-items:flex-start; border-bottom: 3px solid #16a34a; padding-bottom: 10px; margin-bottom: 14px; }
  .tag { display:inline-block; background:#ecfdf3; color:#15803d; border-radius: 6px; padding: 2px 8px; font-size: 8.5pt; font-weight:600; }
  .scores { display:grid; grid-template-columns: repeat(5, 1fr); gap: 8px; margin: 12px 0 4px; }
  .score { border:1px solid #e5e7eb; border-radius: 10px; padding: 10px; text-align:center; }
  .sv { font-size: 20pt; font-weight: 700; }
  .sl { font-size: 8.5pt; font-weight:600; margin-top:2px; }
  .sc { font-size: 7.5pt; color:#6b7280; }
  table { width:100%; border-collapse: collapse; font-size: 9pt; }
  th, td { text-align:left; vertical-align: top; padding: 6px 8px; border-bottom: 1px solid #eef0f3; }
  th { background:#f7f8fa; font-weight:600; }
  ul { margin: 0; padding-left: 18px; }
  li { margin: 3px 0; }
  a { color:#15803d; text-decoration:none; word-break: break-all; }
  .sev-alta { color:#dc2626; font-weight:600; } .sev-média { color:#d97706; font-weight:600; } .sev-baixa { color:#6b7280; }
  .r-PASS { color:#16a34a; } .r-FAIL { color:#dc2626; } .r-WARN { color:#d97706; } .r-NOT_EVALUATED { color:#9aa1ac; }
  .box { background:#f7f8fa; border-radius:10px; padding: 12px 14px; }
  .disclaimer { font-size: 8pt; color:#6b7280; margin-top: 18px; border-top:1px solid #e5e7eb; padding-top: 8px; }
  .avoid { break-inside: avoid; }
</style></head><body>
<div class="brand">
  <div><span class="tag">Relatório de presença digital</span><h1>${esc(r.company.name)}</h1>
  <div class="muted">${esc([r.company.category, [r.company.city, r.company.state].filter(Boolean).join("/")].filter(Boolean).join(" · "))}${r.company.website ? ` · ${esc(r.company.website)}` : ""}</div></div>
  <div class="muted" style="text-align:right;font-size:9pt">${esc(r.organizationName)}<br>Gerado em ${esc(date)}<br>Metodologia ${esc(r.audit.methodologyVersion)}</div>
</div>
<div class="scores">${scoreCards}</div>
<h2>Resumo executivo</h2><div class="box">${esc(r.audit.summary)}</div>
${lh ? `<p class="muted" style="font-size:8.5pt">Lighthouse (celular): desempenho ${lh.performance != null ? Math.round(lh.performance * 100) : "—"}, acessibilidade ${lh.accessibility != null ? Math.round(lh.accessibility * 100) : "—"}, boas práticas ${lh.bestPractices != null ? Math.round(lh.bestPractices * 100) : "—"}, SEO ${lh.seo != null ? Math.round(lh.seo * 100) : "—"}${lh.lcpMs ? ` · LCP ${(lh.lcpMs / 1000).toFixed(1)} s` : ""}.</p>` : ""}
<div class="avoid"><h2>Pontos positivos</h2>${r.audit.positives.length ? `<ul>${r.audit.positives.slice(0, 12).map((p) => `<li><b>${esc(p.label)}</b>${p.detail ? ` — ${esc(p.detail)}` : ""}</li>`).join("")}</ul>` : '<p class="muted">Nenhum ponto positivo verificável nos itens analisados.</p>'}</div>
<h2>Problemas encontrados (com evidência)</h2>
${r.audit.problems.length ? `<table><thead><tr><th>Item</th><th>Gravidade</th><th>Evidência</th></tr></thead><tbody>${r.audit.problems.map((p) => `<tr class="avoid"><td><b>${esc(p.label)}</b></td><td class="sev-${esc(p.severity)}">${esc(p.severity)}</td><td>${esc(p.detail)}${link(p.url)}</td></tr>`).join("")}</tbody></table>` : '<p class="muted">Nenhum problema comprovado nos itens que puderam ser verificados.</p>'}
<h2>Recomendações priorizadas</h2>
${r.audit.recommendations.length ? `<table><thead><tr><th>#</th><th>Recomendação</th><th>Impacto potencial</th></tr></thead><tbody>${r.audit.recommendations.map((x) => `<tr class="avoid"><td>P${x.priority}</td><td><b>${esc(x.title)}</b><br><span class="muted">${esc(x.action)}</span></td><td>${esc(x.impact)}</td></tr>`).join("")}</tbody></table>` : '<p class="muted">Sem recomendações.</p>'}
${r.audit.services.length ? `<div class="avoid"><h2>Serviços sugeridos</h2><ul>${r.audit.services.map((s) => `<li><b>${esc(s.name)}</b> <span class="muted">— ${esc(s.reason)}</span></li>`).join("")}</ul></div>` : ""}
<h2>Evidências por critério</h2>
<table><thead><tr><th>Dimensão</th><th>Critério</th><th>Resultado</th><th>Detalhe</th></tr></thead><tbody>
${r.evidence.map((e) => `<tr class="avoid"><td>${esc(DIM[e.dimension] ?? e.dimension)}</td><td>${esc(e.label)}</td><td class="r-${esc(e.result)}">${esc(RESULT[e.result] ?? e.result)}</td><td>${esc(e.detail)}${link(e.url)}</td></tr>`).join("")}
</tbody></table>
<div class="disclaimer">
Estimativa interna produzida a partir de informações públicas acessíveis em ${esc(date)} (site oficial, fichas públicas e fontes abertas). Não é uma auditoria oficial do Google nem atesta verificação ou gestão do perfil da empresa.
Critérios sem dados acessíveis são marcados como “Não avaliado” e não reduzem a pontuação; a confiança indica a parcela dos critérios efetivamente verificada.
A existência de registro MX não garante entrega de e-mail. Nenhum número de seguidores ou engajamento é estimado.
</div>
</body></html>`;
}

/** Gera o PDF com o Chromium do Playwright (disponível na imagem Docker da API). */
export async function renderPdf(html: string): Promise<Buffer> {
  let chromium: typeof import("playwright").chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    throw unavailable("Geração de PDF indisponível (Playwright não instalado).");
  }
  if (!existsSync(chromium.executablePath())) throw unavailable("Navegador para gerar PDF indisponível neste ambiente. Use a versão em Docker.");
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] }).catch((err) => {
    logger.warn({ err: (err as Error).message }, "Chromium indisponível para PDF");
    return null;
  });
  if (!browser) throw unavailable("Navegador para gerar PDF indisponível neste ambiente. Use a versão em Docker.");
  try {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    // bloqueia qualquer carregamento externo durante a renderização do relatório
    await page.route("**/*", (route) => (route.request().url().startsWith("data:") ? route.continue() : route.abort()));
    await page.setContent(html, { waitUntil: "load" });
    const pdf = await page.pdf({ format: "A4", printBackground: true, displayHeaderFooter: true, headerTemplate: "<span></span>", footerTemplate: '<div style="font-size:7pt;color:#9aa1ac;width:100%;text-align:center;">Página <span class="pageNumber"></span> de <span class="totalPages"></span></div>', margin: { top: "16mm", bottom: "18mm", left: "14mm", right: "14mm" } });
    return Buffer.from(pdf);
  } finally {
    await browser.close().catch(() => undefined);
  }
}
