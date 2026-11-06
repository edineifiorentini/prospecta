"use client";

import { AlertTriangle, ShieldCheck, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { SectionCard } from "@/components/page";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";

type Field = { overall: string | null; originFallback: boolean; inpMs: number | null; inpCategory: string | null; lcpMs: number | null; lcpCategory: string | null; cls: number | null; clsCategory: string | null };
type Psi = { strategy: "mobile" | "desktop"; performance: number | null; seo: number | null; accessibility: number | null; bestPractices: number | null; lcpMs: number | null; cls: number | null; tbtMs: number | null; field: Field | null; simulated: boolean };
export type Diagnostics = {
  checkedAt: string;
  site: { finalUrl: string | null; https: boolean; httpRedirectsToHttps: boolean | null; httpsAvailable: boolean | null; canonical: string | null; robotsFound: boolean; sitemapFound: boolean } | null;
  tls: { checked: boolean; valid: boolean | null; error: string | null; issuer: string | null; validTo: string | null; daysLeft: number | null; protocol: string | null } | null;
  technologies: { name: string; category: string; evidence: string }[];
  pagesRead: number;
  pagespeed: { enabled: boolean; mobile: Psi | null; desktop: Psi | null; error: { code: string; message: string } | null };
  lighthouseSource: "local" | "pagespeed" | null;
  findings: { key: string; severity: "alta" | "media" | "baixa"; title: string; evidence: string; opportunity: string; source: string }[];
};

const CATEGORY: Record<string, string> = {
  cms: "Plataforma do site",
  ecommerce: "Loja virtual",
  framework: "Frameworks e bibliotecas",
  analytics: "Análise de audiência",
  pixel: "Pixels de anúncios",
  chat: "Atendimento no site",
  marketing: "Automação de marketing",
  conversao: "Recursos de conversão",
};
const SEVERITY: Record<string, string> = { alta: "bg-destructive/10 text-destructive", media: "bg-warning-soft text-[color-mix(in_oklch,var(--warning),black_35%)] dark:text-warning", baixa: "bg-muted text-muted-foreground" };
const CATEGORY_LABEL: Record<string, string> = { FAST: "bom", AVERAGE: "regular", SLOW: "ruim" };
const pct = (v: number | null | undefined) => (v == null ? "Não disponível" : `${Math.round(v * 100)}/100`);
const sec = (ms: number | null | undefined) => (ms == null ? "Não disponível" : `${(ms / 1000).toFixed(1).replace(".", ",")} s`);

export function DiagnosticsCard({ d }: { d: Diagnostics }) {
  const groups = Object.entries(
    d.technologies.reduce<Record<string, string[]>>((acc, t) => {
      (acc[t.category] ??= []).push(t.name);
      return acc;
    }, {}),
  );
  const field = d.pagespeed.mobile?.field ?? d.pagespeed.desktop?.field ?? null;
  return (
    <SectionCard title="Diagnóstico técnico" description={`Medições complementares de ${fmtDate(d.checkedAt)}. Não entram nas notas; os achados abaixo são só os comprovados.`}>
      <div className="grid gap-5 text-sm">
        {d.findings.length > 0 ? (
          <ul className="grid gap-2">
            {d.findings.map((f) => (
              <li key={f.key} className="rounded-md border px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium uppercase", SEVERITY[f.severity])}>{f.severity === "media" ? "média" : f.severity}</span>
                  <span className="font-medium">{f.title}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{f.evidence}</p>
                <p className="mt-1 text-xs">
                  <span className="font-medium">Por que pode ser oportunidade:</span> {f.opportunity}
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">Fonte: {f.source}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">Nenhum problema técnico comprovado nas verificações complementares.</p>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          <section className="grid gap-1.5">
            <h3 className="text-sm font-semibold">Segurança básica</h3>
            {d.tls?.checked ? (
              <p className="flex items-center gap-1.5">
                {d.tls.valid ? <ShieldCheck className="size-4 text-success" /> : <ShieldAlert className="size-4 text-destructive" />}
                {d.tls.valid ? `Certificado válido até ${fmtDate(d.tls.validTo)}${d.tls.issuer ? ` (${d.tls.issuer})` : ""}` : `Certificado não confiável: ${d.tls.error}`}
              </p>
            ) : (
              <p className="text-muted-foreground">Certificado não verificado{d.tls?.error ? `: ${d.tls.error}` : ""}.</p>
            )}
            {d.site && (
              <p className="text-xs text-muted-foreground">
                HTTPS {d.site.https ? "ativo" : "ausente"} · redirecionamento de HTTP para HTTPS: {d.site.httpRedirectsToHttps == null ? "não verificado" : d.site.httpRedirectsToHttps ? "sim" : "não"} · URL canônica: {d.site.canonical ? "definida" : "não definida"}
              </p>
            )}
          </section>
          <section className="grid gap-1.5">
            <h3 className="text-sm font-semibold">Tecnologias detectadas</h3>
            {groups.length ? (
              <dl className="grid gap-1">
                {groups.map(([cat, names]) => (
                  <div key={cat} className="flex flex-wrap items-center gap-1.5 text-xs">
                    <dt className="text-muted-foreground">{CATEGORY[cat] ?? cat}:</dt>
                    {names.map((n) => (
                      <Badge key={n} variant="secondary" className="text-[11px]">
                        {n}
                      </Badge>
                    ))}
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-muted-foreground">Nenhuma assinatura conhecida nas {d.pagesRead} página(s) lidas.</p>
            )}
            <p className="text-[11px] text-muted-foreground">Detectado = encontrado no código das páginas lidas. Não detectado não significa que a empresa não use: o recurso pode carregar depois ou estar em outra página.</p>
          </section>
        </div>

        <section className="grid gap-1.5">
          <h3 className="text-sm font-semibold">Desempenho (PageSpeed Insights)</h3>
          {!d.pagespeed.enabled ? (
            <p className="text-muted-foreground">PageSpeed desligado nesta conta (Configurações › Integrações).{d.lighthouseSource === "local" ? " As notas usam o Lighthouse local." : ""}</p>
          ) : d.pagespeed.error && !d.pagespeed.mobile ? (
            <p className="flex items-center gap-1.5 text-muted-foreground">
              <AlertTriangle className="size-4" /> PageSpeed não respondeu: {d.pagespeed.error.message}
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {[d.pagespeed.mobile, d.pagespeed.desktop].map((r, i) => (
                <div key={i} className="rounded-md border px-3 py-2 text-xs">
                  <div className="font-medium">{i === 0 ? "Celular" : "Computador"}{r?.simulated ? " (simulado)" : ""}</div>
                  {r ? (
                    <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5">
                      <span>Desempenho {pct(r.performance)}</span>
                      <span>SEO {pct(r.seo)}</span>
                      <span>LCP {sec(r.lcpMs)}</span>
                      <span>CLS {r.cls != null ? String(r.cls).replace(".", ",") : "Não disponível"}</span>
                    </div>
                  ) : (
                    <p className="mt-1 text-muted-foreground">Não disponível</p>
                  )}
                </div>
              ))}
            </div>
          )}
          {d.pagespeed.enabled && (
            <p className="text-xs text-muted-foreground">
              Usuários reais (Chrome, 75% das visitas):{" "}
              {field ? `INP ${field.inpMs != null ? `${field.inpMs} ms (${CATEGORY_LABEL[field.inpCategory ?? ""] ?? "—"})` : "Não disponível"} · LCP ${sec(field.lcpMs)} (${CATEGORY_LABEL[field.lcpCategory ?? ""] ?? "—"})${field.originFallback ? " · medido no domínio todo" : ""}` : "Não disponível (o site não tem tráfego suficiente no relatório do Chrome)."}
            </p>
          )}
        </section>
      </div>
    </SectionCard>
  );
}
