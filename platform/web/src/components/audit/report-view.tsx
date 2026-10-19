"use client";

import { AlertTriangle, CheckCircle2, CircleDashed, ExternalLink, Lightbulb, MinusCircle, ShoppingBag, XCircle } from "lucide-react";
import { SectionCard } from "@/components/page";
import { ScorePill } from "@/components/score-pill";
import { StatusBadge } from "@/components/status-badge";
import { SCORE_LABEL } from "@/lib/labels";
import { fmtDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export type AuditScores = Record<string, { score: number | null; confidence: number; evaluated?: number; total?: number }>;
export type AuditDetail = {
  id: string;
  status: string;
  methodologyVersion: string;
  scores: AuditScores;
  summary: string | null;
  positives: { key: string; label: string; detail: string | null; url: string | null }[];
  problems: { key: string; label: string; detail: string | null; url: string | null; severity: "alta" | "média" | "baixa"; dimension: string }[];
  recommendations: { key: string; title: string; action: string; impact: string; priority: number; evidence: string | null; url: string | null }[];
  services: { key: string; name: string; reason: string }[];
  lighthouse: { performance: number | null; accessibility: number | null; bestPractices: number | null; seo: number | null; lcpMs: number | null } | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
  company: { id: string; name: string; category: string | null; city: string | null; state: string | null; website: string | null; sourceUrl: string | null };
  evidence: { id: string; dimension: string; criterion: string; label: string; result: string; weight: number; detail: string | null; url: string | null; observedAt: string }[];
};

const KINDS = ["OPPORTUNITY", "DATA_QUALITY", "GOOGLE_PRESENCE", "WEBSITE_QUALITY", "MULTICHANNEL"];

export function ScoreGrid({ scores }: { scores: AuditScores }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {KINDS.map((k) => {
        const s = scores[k];
        return (
          <div key={k} className={cn("card-soft p-4", k === "OPPORTUNITY" && "border-primary/30 bg-accent/30")}>
            <div className="text-xs text-muted-foreground">{SCORE_LABEL[k]}</div>
            <div className="mt-2 flex items-end justify-between gap-2">
              <span className={cn("text-3xl font-semibold tracking-tight num", s?.score == null && "text-muted-foreground")}>{s?.score ?? "—"}</span>
              <ScorePill score={s?.score ?? null} confidence={s?.confidence} label={SCORE_LABEL[k]} />
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">{s?.score == null ? "Não avaliado" : `Confiança ${Math.round((s?.confidence ?? 0) * 100)}%`}</div>
          </div>
        );
      })}
    </div>
  );
}

const RESULT_ICON: Record<string, React.ReactNode> = {
  PASS: <CheckCircle2 className="size-4 text-success" />,
  FAIL: <XCircle className="size-4 text-destructive" />,
  WARN: <AlertTriangle className="size-4 text-warning" />,
  NOT_EVALUATED: <CircleDashed className="size-4 text-muted-foreground" />,
  INFO: <MinusCircle className="size-4 text-muted-foreground" />,
};
const RESULT_LABEL: Record<string, string> = { PASS: "Atende", FAIL: "Não atende", WARN: "Parcial", NOT_EVALUATED: "Não avaliado", INFO: "Info" };

export function ReportBody({ audit, compact }: { audit: AuditDetail; compact?: boolean }) {
  const lh = audit.lighthouse;
  return (
    <div className="grid gap-6">
      <ScoreGrid scores={audit.scores} />
      <SectionCard title="Resumo executivo" description={`Concluída ${fmtDateTime(audit.finishedAt)} · metodologia ${audit.methodologyVersion}`}>
        <p className="text-sm leading-relaxed text-pretty">{audit.summary}</p>
        {lh && (
          <p className="mt-3 text-xs text-muted-foreground">
            Lighthouse (celular): desempenho {pct(lh.performance)} · acessibilidade {pct(lh.accessibility)} · boas práticas {pct(lh.bestPractices)} · SEO {pct(lh.seo)}
            {lh.lcpMs ? ` · LCP ${(lh.lcpMs / 1000).toFixed(1)} s` : ""}
          </p>
        )}
      </SectionCard>
      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard title="Problemas encontrados" description="Somente itens com evidência coletada." bodyClassName="p-0">
          {!audit.problems.length ? (
            <p className="px-5 py-6 text-sm text-muted-foreground">Nenhum problema comprovado nos itens verificáveis.</p>
          ) : (
            <ul className="divide-y">
              {audit.problems.slice(0, compact ? 6 : undefined).map((p) => (
                <li key={p.key} className="px-5 py-3">
                  <div className="flex items-center gap-2">
                    <StatusBadge tone={p.severity === "alta" ? "danger" : p.severity === "média" ? "warning" : "neutral"}>{p.severity}</StatusBadge>
                    <span className="text-sm font-medium">{p.label}</span>
                  </div>
                  {p.detail && <p className="mt-1 text-xs text-muted-foreground">{p.detail}</p>}
                  {p.url && <EvidenceLink url={p.url} />}
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
        <SectionCard title="Pontos positivos" bodyClassName="p-0">
          {!audit.positives.length ? (
            <p className="px-5 py-6 text-sm text-muted-foreground">Nenhum ponto positivo verificável.</p>
          ) : (
            <ul className="divide-y">
              {audit.positives.slice(0, compact ? 6 : undefined).map((p) => (
                <li key={p.key} className="flex items-start gap-2 px-5 py-3">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{p.label}</div>
                    {p.detail && <p className="truncate text-xs text-muted-foreground">{p.detail}</p>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
      <SectionCard title="Recomendações priorizadas" bodyClassName="p-0">
        {!audit.recommendations.length ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">Sem recomendações.</p>
        ) : (
          <ul className="divide-y">
            {audit.recommendations.slice(0, compact ? 5 : undefined).map((r) => (
              <li key={r.key} className="flex items-start gap-3 px-5 py-3">
                <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-accent text-xs font-semibold text-accent-foreground">P{r.priority}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{r.title}</span>
                    <span className="text-[11px] text-muted-foreground">impacto {r.impact.toLowerCase()}</span>
                  </div>
                  <p className="mt-0.5 text-sm text-muted-foreground">{r.action}</p>
                  {r.evidence && (
                    <p className="mt-1 flex items-start gap-1 text-xs text-muted-foreground">
                      <Lightbulb className="mt-0.5 size-3 shrink-0" /> Evidência: {r.evidence}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
      {audit.services.length > 0 && (
        <SectionCard title="Serviços que podem ser oferecidos" description="Argumentos comerciais baseados nos problemas comprovados.">
          <ul className="grid gap-2 sm:grid-cols-2">
            {audit.services.map((s) => (
              <li key={s.key} className="flex items-start gap-2 rounded-lg border bg-surface p-3">
                <ShoppingBag className="mt-0.5 size-4 shrink-0 text-primary" />
                <div>
                  <div className="text-sm font-medium">{s.name}</div>
                  <div className="text-xs text-muted-foreground">{s.reason}</div>
                </div>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}
      {!compact && (
        <SectionCard title="Evidências por critério" description="Peso, resultado e detalhe de cada critério. “Não avaliado” não entra no cálculo." bodyClassName="p-0">
          {KINDS.map((k) => {
            const rows = audit.evidence.filter((e) => e.dimension === k);
            if (!rows.length) return null;
            return (
              <div key={k}>
                <div className="border-y bg-muted/40 px-5 py-2 text-xs font-semibold">{SCORE_LABEL[k]}</div>
                <ul className="divide-y">
                  {rows.map((e) => (
                    <li key={e.id} className="grid gap-1 px-5 py-2.5 sm:grid-cols-[1.5rem_16rem_6rem_1fr]">
                      <span>{RESULT_ICON[e.result]}</span>
                      <span className="text-sm">{e.label}</span>
                      <span className="text-xs text-muted-foreground">
                        {RESULT_LABEL[e.result]} · peso {e.weight}
                      </span>
                      <span className="min-w-0 text-xs text-muted-foreground">
                        {e.detail}
                        {e.url && <EvidenceLink url={e.url} inline />}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </SectionCard>
      )}
      <p className="text-[11px] text-muted-foreground">
        Estimativa interna com base em dados públicos acessíveis na data da coleta. Não é auditoria oficial do Google e não atesta verificação ou gestão do perfil da empresa. MX não garante entrega de e-mail. Seguidores e engajamento não são
        estimados.
      </p>
    </div>
  );
}

const pct = (v: number | null) => (v == null ? "—" : Math.round(v * 100));

function EvidenceLink({ url, inline }: { url: string; inline?: boolean }) {
  return (
    <a href={url} target="_blank" rel="noopener noreferrer nofollow" className={cn("inline-flex items-center gap-1 text-xs text-primary hover:underline", inline ? "ml-1" : "mt-1")}>
      fonte <ExternalLink className="size-3" />
    </a>
  );
}
