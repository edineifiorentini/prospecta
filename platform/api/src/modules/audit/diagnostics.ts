import type { CrawlResult } from "../enrichment/crawler.ts";
import type { LighthouseSummary } from "./evaluate.ts";
import type { PageSpeedRun } from "./pagespeed.ts";
import type { Technology } from "./technologies.ts";
import type { TlsInfo } from "./tls.ts";

/**
 * Diagnóstico técnico complementar da auditoria (DigitalAudit.diagnostics). Não entra nas notas: mostra o que foi
 * medido, com a fonte, e só aponta achados COMPROVADOS. Tecnologia não detectada nunca vira achado, e um achado
 * indica espaço para melhoria — não afirma que a empresa precisa contratar algo.
 */
export type Severity = "alta" | "media" | "baixa";
export type Finding = { key: string; severity: Severity; title: string; evidence: string; opportunity: string; source: string };

export type Diagnostics = {
  version: 1;
  checkedAt: string;
  site: { finalUrl: string | null; https: boolean; httpRedirectsToHttps: boolean | null; httpsAvailable: boolean | null; canonical: string | null; robotsFound: boolean; sitemapFound: boolean } | null;
  tls: TlsInfo | null;
  technologies: Technology[];
  pagesRead: number;
  pagespeed: { enabled: boolean; mobile: PageSpeedRun | null; desktop: PageSpeedRun | null; error: { code: string; message: string } | null };
  lighthouseSource: "local" | "pagespeed" | null;
  findings: Finding[];
};

const pct = (v: number) => Math.round(v * 100);
const sec = (ms: number) => `${(ms / 1000).toFixed(1).replace(".", ",")} s`;

export function buildDiagnostics(input: {
  crawl: CrawlResult | null;
  tls: TlsInfo | null;
  lighthouse: LighthouseSummary | null;
  pagespeed: Diagnostics["pagespeed"];
  now?: Date;
}): Diagnostics {
  const { crawl, tls, lighthouse, pagespeed } = input;
  const read = crawl && crawl.reachable && !crawl.blockedReason ? crawl : null;
  const home = read?.pages[0] ?? null;
  const tech = new Map<string, Technology>();
  for (const p of read?.pages ?? []) for (const t of p.technologies ?? []) if (!tech.has(t.name)) tech.set(t.name, t);
  const findings: Finding[] = [];
  const add = (f: Finding) => findings.push(f);

  if (read && !read.https && read.httpsAvailable === false)
    add({ key: "https.ausente", severity: "alta", title: "Site sem HTTPS", evidence: "O site responde só em HTTP; a versão HTTPS não respondeu.", opportunity: "Navegadores marcam o site como \"não seguro\", o que pode afastar visitantes e prejudicar o Google.", source: "Leitura do site" });
  else if (read && read.httpRedirectsToHttps === false)
    add({ key: "https.redirecionamento", severity: "media", title: "Endereço sem HTTPS não redireciona para a versão segura", evidence: "Quem digita o endereço sem https continua na versão insegura.", opportunity: "Ajuste técnico simples que evita alerta de \"não seguro\" e conteúdo duplicado.", source: "Leitura do site" });
  if (tls?.checked && tls.valid === false)
    add({ key: "tls.invalido", severity: "alta", title: "Certificado HTTPS não é confiável", evidence: tls.error ?? "certificado recusado", opportunity: "Navegadores exibem alerta de segurança antes de abrir o site; a correção é técnica e verificável.", source: "Conexão TLS" });
  else if (tls?.checked && tls.valid && tls.daysLeft != null && tls.daysLeft < 15)
    add({ key: "tls.vencendo", severity: "media", title: `Certificado HTTPS vence em ${Math.max(0, tls.daysLeft)} dia(s)`, evidence: `Validade até ${tls.validTo?.slice(0, 10).split("-").reverse().join("/")}${tls.issuer ? `, emitido por ${tls.issuer}` : ""}.`, opportunity: "Sem renovação, o site passa a exibir alerta de segurança.", source: "Conexão TLS" });
  if (home && !home.canonical)
    add({ key: "seo.canonical", severity: "baixa", title: "Página inicial sem URL canônica", evidence: "Nenhuma tag link rel=\"canonical\" na página inicial.", opportunity: "Ajuda os buscadores a não tratar versões do mesmo endereço como páginas duplicadas.", source: "Leitura do site" });

  // desempenho no celular: PageSpeed (laboratório) ou, sem ele, o Lighthouse local
  const mobile = pagespeed.mobile;
  const perf = mobile?.performance ?? lighthouse?.performance ?? null;
  const perfSource = mobile ? "PageSpeed Insights (laboratório, celular)" : lighthouse ? `Lighthouse ${lighthouse.source === "pagespeed" ? "via PageSpeed" : "local"} (celular)` : "";
  if (perf != null && perf < 0.5)
    add({ key: "perf.celular", severity: perf < 0.3 ? "alta" : "media", title: `Desempenho baixo no celular (${pct(perf)}/100)`, evidence: `${mobile?.lcpMs ?? lighthouse?.lcpMs ? `Conteúdo principal em ${sec((mobile?.lcpMs ?? lighthouse?.lcpMs)!)}` : "Nota de desempenho"} na medição de laboratório.`, opportunity: "Páginas lentas no celular tendem a perder visitantes; há espaço para otimização, a confirmar com o responsável pelo site.", source: perfSource });
  const field = mobile?.field ?? pagespeed.desktop?.field ?? null;
  if (field?.lcpCategory === "SLOW" && field.lcpMs != null)
    add({ key: "campo.lcp", severity: "alta", title: "Usuários reais esperam demais pelo conteúdo principal", evidence: `LCP de ${sec(field.lcpMs)} (75% das visitas)${field.originFallback ? ", medido no domínio todo" : ""}.`, opportunity: "Dado de visitantes reais (Chrome): é uma lentidão percebida, não só de laboratório.", source: "PageSpeed Insights (dados de usuários, CrUX)" });
  if (field?.inpCategory === "SLOW" && field.inpMs != null)
    add({ key: "campo.inp", severity: "media", title: "Resposta lenta a toques e cliques", evidence: `INP de ${field.inpMs} ms (75% das visitas)${field.originFallback ? ", medido no domínio todo" : ""}.`, opportunity: "Interações lentas atrapalham formulários e botões de contato.", source: "PageSpeed Insights (dados de usuários, CrUX)" });
  const seo = mobile?.seo ?? lighthouse?.seo ?? null;
  if (seo != null && seo < 0.7)
    add({ key: "seo.nota", severity: "media", title: `SEO técnico com pendências (${pct(seo)}/100)`, evidence: "Nota de SEO do Lighthouse abaixo de 70.", opportunity: "Correções técnicas costumam melhorar a leitura do site pelos buscadores.", source: perfSource || "Lighthouse" });

  const order: Record<Severity, number> = { alta: 0, media: 1, baixa: 2 };
  return {
    version: 1,
    checkedAt: (input.now ?? new Date()).toISOString(),
    site: crawl ? { finalUrl: crawl.finalUrl, https: crawl.https, httpRedirectsToHttps: crawl.httpRedirectsToHttps, httpsAvailable: crawl.httpsAvailable, canonical: home?.canonical ?? null, robotsFound: crawl.robots.found, sitemapFound: crawl.sitemapFound } : null,
    tls,
    technologies: [...tech.values()],
    pagesRead: read?.pages.length ?? 0,
    pagespeed,
    lighthouseSource: lighthouse ? (lighthouse.source ?? "local") : null,
    findings: findings.sort((a, b) => order[a.severity] - order[b.severity]),
  };
}
