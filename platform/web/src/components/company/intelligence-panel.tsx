"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Check, CircleDashed, Copy, ExternalLink, History, Loader2, Minus, RotateCcw, Save, Sparkles, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ErrorState, SectionCard } from "@/components/page";
import { api, errorMessage } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { useSession } from "@/lib/session";
import { useSyncedState } from "@/lib/hooks";
import { cn } from "@/lib/utils";

// ── Tipos devolvidos pela API (modules/intelligence) ──
type Result = "MET" | "PARTIAL" | "NOT_MET" | "NOT_EVALUATED";
type Criterion = { key: string; label: string; weight: number; result: Result; points: number; justification: string; evidenceKeys: string[] };
type Indicator = { id: "FIT" | "OPPORTUNITY" | "RELIABILITY"; score: number | null; coverage: number; criteria: Criterion[] };
type Evidence = { key: string; label: string; kind: "OBSERVED" | "INFERRED"; source: string; sourceUrl: string | null; observedAt: string | null };
type Intelligence = {
  methodology: string;
  indicators: Record<Indicator["id"], Indicator>;
  priority: "A" | "B" | "C" | "NEEDS_QUALIFICATION";
  composite: number | null;
  priorityReasons: string[];
  evidence: Evidence[];
  phones: { e164: string; national: string; kind: "MOBILE" | "FIXED" | "TOLL_FREE" | "UNKNOWN"; whatsapp: "CONFIRMED" | "NOT_CONFIRMED"; sourceCount: number }[];
  rejectedPhones: { raw: string; reason: string }[];
  issues: { code: string; severity: "INFO" | "WARN"; message: string }[];
  segment: { id: string; label: string; matchedTerm: string; painHypotheses: string[]; diagnosticQuestions: string[] } | null;
};
type EvidenceRef = { id: string; label: string; source: string; sourceUrl: string | null; observedAt: string | null };
type Analysis = {
  id: string;
  status: "SUCCEEDED" | "FAILED";
  provider: string | null;
  providerLabel: string | null;
  model: string | null;
  generatedAt: string;
  summary: string | null;
  verifiedFacts: { fact: string; evidence: EvidenceRef[] }[];
  opportunityHypotheses: { hypothesis: string; basis: string; confidence: string; evidence: EvidenceRef[] }[];
  confidence: string | null;
  diagnosticQuestions: string[];
  personalizedMessage: string | null;
  editedMessage: string | null;
  possibleObjections: { objection: string; response: string }[];
  recommendedNextAction: { action: string; rationale: string } | null;
  limitations: string[];
  notes: string[];
  tokenUsage: { input: number | null; output: number | null; reasoning: number | null };
  estimatedCost: { usd: number | null; known: boolean; basis: string | null };
  attempts: { provider: string; model: string; ok: boolean; error: string | null }[];
  errorCode: string | null;
  error: string | null;
  cached: boolean;
};
type Provider = { id: string; label: string; configured: boolean; defaultModel: string; suggestedModels: string[] };
type AiConfig = { settings: { enabled: boolean; mode: "manual" | "auto"; primaryProvider: string | null; models: Record<string, string> }; providers: Provider[] };
type Estimate = { limitUsd: number; steps: { provider: string; label: string; model: string; configured: boolean; estimate: { usd: number | null; known: boolean; basis: string }; blocked: { message: string } | null }[] };

const INDICATOR = { FIT: "Aderência ao perfil", OPPORTUNITY: "Oportunidade comercial", RELIABILITY: "Confiabilidade dos dados" } as const;
const PRIORITY: Record<Intelligence["priority"], { label: string; tone: string }> = {
  A: { label: "Prioridade A", tone: "bg-success-soft text-success" },
  B: { label: "Prioridade B", tone: "bg-info-soft text-info" },
  C: { label: "Prioridade C", tone: "bg-muted text-muted-foreground" },
  NEEDS_QUALIFICATION: { label: "Necessita qualificação", tone: "bg-warning-soft text-[color-mix(in_oklch,var(--warning),black_35%)] dark:text-warning" },
};
const RESULT_ICON: Record<Result, { icon: typeof Check; tone: string; label: string }> = {
  MET: { icon: Check, tone: "text-success", label: "Atende" },
  PARTIAL: { icon: Minus, tone: "text-[color-mix(in_oklch,var(--warning),black_25%)] dark:text-warning", label: "Parcial" },
  NOT_MET: { icon: X, tone: "text-muted-foreground", label: "Não atende" },
  NOT_EVALUATED: { icon: CircleDashed, tone: "text-muted-foreground/70", label: "Não avaliado" },
};
const PHONE_KIND = { MOBILE: "Celular", FIXED: "Fixo", TOLL_FREE: "0800", UNKNOWN: "Não identificado" } as const;
const SOURCE: Record<string, string> = { GOOGLE_MAPS_SCRAPER: "Google Maps", WEBSITE: "Site oficial", MANUAL: "Manual", CSV_IMPORT: "Importação", OSM_OVERPASS: "OpenStreetMap", BRASILAPI_CNPJ: "BrasilAPI", SYSTEM: "Prospecta" };
const NEXT_ACTION: Record<string, string> = {
  VERIFY_DECISION_MAKER: "Verificar o responsável comercial",
  QUALIFY_OPERATION: "Qualificar a operação de atendimento",
  REQUEST_CONVERSATION: "Solicitar uma conversa",
  PRESENT_DEMO: "Apresentar uma demonstração",
  AWAIT_REPLY: "Aguardar retorno",
  CLOSE_CONTACT: "Encerrar o contato",
};
const CONFIDENCE: Record<string, string> = { baixa: "confiança baixa", media: "confiança média", alta: "confiança alta" };
const usd = (v: number) => `US$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`;
const DEFAULT = "__padrao__";

export function CompanyIntelligencePanel({ companyId }: { companyId: string }) {
  const q = useQuery({ queryKey: ["intelligence", companyId], queryFn: () => api<Intelligence>(`/companies/${companyId}/intelligence`) });
  if (q.isLoading) return <Skeleton className="h-96 w-full" />;
  if (q.error || !q.data) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  const d = q.data;
  return (
    <div className="grid gap-6">
      <PriorityCard data={d} />
      <div className="grid gap-6 lg:grid-cols-2">
        <EvidenceCard evidence={d.evidence} />
        <QualityCard data={d} />
      </div>
      {d.segment && <SegmentCard segment={d.segment} />}
      <AiAnalysisCard companyId={companyId} />
    </div>
  );
}

function PriorityCard({ data: d }: { data: Intelligence }) {
  const p = PRIORITY[d.priority];
  return (
    <SectionCard
      title="Indicadores comerciais"
      description={`Três notas independentes, calculadas só com dados coletados (metodologia ${d.methodology}).`}
      actions={<span className={cn("rounded-md px-2 py-1 text-xs font-semibold", p.tone)}>{p.label}{d.composite != null ? ` · ${d.composite}` : ""}</span>}
    >
      <ul className="mb-5 space-y-0.5 text-xs text-muted-foreground">
        {d.priorityReasons.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
      <div className="grid gap-4 lg:grid-cols-3">
        {(["FIT", "OPPORTUNITY", "RELIABILITY"] as const).map((id) => {
          const ind = d.indicators[id];
          return (
            <div key={id} className="rounded-lg border p-4">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold">{INDICATOR[id]}</h3>
                <span className="text-2xl font-semibold num">{ind.score ?? "—"}</span>
              </div>
              <p className="mb-3 text-[11px] text-muted-foreground">{ind.score == null ? "Dados insuficientes para dar nota." : `${Math.round(ind.coverage * 100)}% do peso avaliado`}</p>
              <ul className="space-y-2.5">
                {ind.criteria.map((c) => {
                  const r = RESULT_ICON[c.result];
                  return (
                    <li key={c.key} className="flex gap-2 text-xs">
                      <r.icon className={cn("mt-0.5 size-3.5 shrink-0", r.tone)} aria-label={r.label} />
                      <div className="min-w-0">
                        <div className="font-medium">
                          {c.label} <span className="font-normal text-muted-foreground">· {c.result === "NOT_EVALUATED" ? "não avaliado" : `${c.points}/${c.weight}`}</span>
                        </div>
                        <p className="text-muted-foreground">{c.justification}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}

function SourceLink({ source, url, date }: { source: string; url: string | null; date: string | null }) {
  const text = `${SOURCE[source] ?? source}${date ? ` · ${fmtDateTime(date)}` : ""}`;
  return url && /^https?:\/\//.test(url) ? (
    <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:underline">
      {text} <ExternalLink className="size-3" />
    </a>
  ) : (
    <span>{text}</span>
  );
}

function EvidenceCard({ evidence }: { evidence: Evidence[] }) {
  return (
    <SectionCard title="Evidências encontradas" description="Observado = visto na fonte. Inferido = deduzido, precisa de confirmação." bodyClassName="p-0">
      <ul className="divide-y">
        {evidence.map((e) => (
          <li key={e.key} className="px-5 py-2.5 text-sm">
            <div className="flex items-start gap-2">
              <Badge variant={e.kind === "OBSERVED" ? "secondary" : "outline"} className="mt-0.5 shrink-0">
                {e.kind === "OBSERVED" ? "Observado" : "Inferido"}
              </Badge>
              <span className="min-w-0">{e.label}</span>
            </div>
            <div className="mt-1 pl-[5.5rem] text-[11px] text-muted-foreground">
              <SourceLink source={e.source} url={e.sourceUrl} date={e.observedAt} />
            </div>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}

function QualityCard({ data: d }: { data: Intelligence }) {
  return (
    <SectionCard title="Qualidade dos dados" description="Telefones normalizados, duplicidades e pontos de atenção.">
      {d.phones.length ? (
        <table className="mb-4 w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="pb-1.5 font-medium">Número</th>
              <th className="pb-1.5 font-medium">Tipo</th>
              <th className="pb-1.5 font-medium">WhatsApp</th>
              <th className="pb-1.5 text-right font-medium">Fontes</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {d.phones.map((p) => (
              <tr key={p.e164}>
                <td className="py-1.5 num">{p.national}</td>
                <td className="py-1.5">{PHONE_KIND[p.kind]}</td>
                <td className="py-1.5">{p.whatsapp === "CONFIRMED" ? <span className="text-success">Confirmado</span> : <span className="text-muted-foreground">Não confirmado</span>}</td>
                <td className="py-1.5 text-right num">{p.sourceCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="mb-4 text-sm text-muted-foreground">Nenhum telefone válido.</p>
      )}
      {d.issues.length ? (
        <ul className="space-y-1.5">
          {d.issues.map((i) => (
            <li key={i.code + i.message} className="flex gap-2 text-xs">
              <AlertTriangle className={cn("mt-0.5 size-3.5 shrink-0", i.severity === "WARN" ? "text-[color-mix(in_oklch,var(--warning),black_25%)] dark:text-warning" : "text-muted-foreground")} />
              <span>{i.message}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">Nenhum problema encontrado.</p>
      )}
    </SectionCard>
  );
}

function SegmentCard({ segment }: { segment: NonNullable<Intelligence["segment"]> }) {
  return (
    <SectionCard title={`Hipóteses de oportunidade · ${segment.label}`} description="Dores comuns no segmento. São hipóteses de mercado: confirme na conversa antes de tratar como fato.">
      <div className="grid gap-6 md:grid-cols-2">
        <div>
          <h3 className="mb-2 text-xs font-semibold text-muted-foreground">Hipóteses</h3>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {segment.painHypotheses.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="mb-2 text-xs font-semibold text-muted-foreground">Perguntas para validar</h3>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {segment.diagnosticQuestions.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
        </div>
      </div>
    </SectionCard>
  );
}

function AiAnalysisCard({ companyId }: { companyId: string }) {
  const qc = useQueryClient();
  const { can } = useSession();
  const canRun = can("ai:run");
  const cfg = useQuery({ queryKey: ["ai-settings"], queryFn: () => api<AiConfig>("/ai/settings") });
  const history = useQuery({ queryKey: ["ai-analyses", companyId], queryFn: () => api<Analysis[]>(`/companies/${companyId}/ai-analyses`) });
  const [provider, setProvider] = useState(DEFAULT);
  const [model, setModel] = useState(DEFAULT);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const choice = { provider: provider === DEFAULT ? undefined : provider, model: provider === DEFAULT || model === DEFAULT ? undefined : model };
  const enabled = !!cfg.data?.settings.enabled;
  const estimate = useQuery({
    queryKey: ["ai-estimate", companyId, choice.provider ?? "", choice.model ?? ""],
    queryFn: () => api<Estimate>(`/companies/${companyId}/ai-analyses/estimate`, { method: "POST", body: choice }),
    enabled: enabled && canRun,
    retry: false,
  });
  const generate = useMutation({
    mutationFn: (force: boolean) => {
      abort.current = new AbortController();
      return api<Analysis>(`/companies/${companyId}/ai-analyses`, { method: "POST", body: { ...choice, force }, signal: abort.current.signal });
    },
    onSuccess: (a) => {
      setSelectedId(a.id);
      qc.invalidateQueries({ queryKey: ["ai-analyses", companyId] });
      if (a.status === "FAILED") toast.error("A análise não foi gerada", { description: a.error ?? undefined });
      else toast.success(a.cached ? "Análise reaproveitada" : "Análise gerada", { description: a.cached ? "Os dados não mudaram desde a última análise; nada foi cobrado." : `${a.providerLabel} · ${a.model}` });
    },
    onError: (e) => toast.error(abort.current?.signal.aborted ? "Análise cancelada" : errorMessage(e)),
  });

  const list = history.data ?? [];
  const current = list.find((a) => a.id === selectedId) ?? list[0] ?? null;
  const providers = cfg.data?.providers ?? [];
  const chosen = providers.find((p) => p.id === provider);
  const primary = providers.find((p) => p.id === cfg.data?.settings.primaryProvider);
  // sem nenhum provedor utilizável (sem chave ou acima do limite) não há o que gerar
  const allBlocked = !!estimate.error || !!estimate.data?.steps.every((s) => s.blocked);

  return (
    <SectionCard
      title={
        <span className="inline-flex items-center gap-1.5">
          <Sparkles className="size-4 text-primary" /> Análise Comercial com IA
        </span>
      }
      description="A IA recebe só os dados acima, sem telefones nem e-mails. Revise tudo antes de usar: nada é enviado automaticamente."
    >
      {!cfg.data ? (
        <Skeleton className="h-10 w-full" />
      ) : !enabled ? (
        <p className="text-sm text-muted-foreground">
          A análise com IA está desativada nesta conta.{" "}
          {can("settings:manage") && (
            <Link href="/configuracoes?tab=ia" className="text-primary hover:underline">
              Ativar em Configurações
            </Link>
          )}
        </p>
      ) : (
        <div className="grid gap-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="grid gap-1">
              <span className="text-xs text-muted-foreground">Provedor</span>
              <Select
                value={provider}
                onValueChange={(v) => {
                  setProvider(v);
                  setModel(DEFAULT);
                }}
              >
                <SelectTrigger className="w-60" aria-label="Provedor de IA">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={DEFAULT}>Padrão da conta{primary ? ` (${primary.label})` : ""}</SelectItem>
                  {providers.map((p) => (
                    <SelectItem key={p.id} value={p.id} disabled={!p.configured}>
                      {p.label}
                      {!p.configured && " · sem chave"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {chosen && (
              <div className="grid gap-1">
                <span className="text-xs text-muted-foreground">Modelo</span>
                <Select value={model} onValueChange={setModel}>
                  <SelectTrigger className="w-52" aria-label="Modelo">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={DEFAULT}>{cfg.data.settings.models[chosen.id] ?? chosen.defaultModel} (padrão)</SelectItem>
                    {chosen.suggestedModels
                      .filter((m) => m !== (cfg.data!.settings.models[chosen.id] ?? chosen.defaultModel))
                      .map((m) => (
                        <SelectItem key={m} value={m}>
                          {m}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {canRun && (
              <div className="flex gap-2">
                {generate.isPending ? (
                  <Button variant="outline" onClick={() => abort.current?.abort()}>
                    <Loader2 className="animate-spin" /> Cancelar
                  </Button>
                ) : (
                  <>
                    <Button onClick={() => generate.mutate(false)} disabled={allBlocked}>
                      <Sparkles /> Gerar análise com IA
                    </Button>
                    {current?.status === "SUCCEEDED" && (
                      <Button variant="ghost" onClick={() => generate.mutate(true)} disabled={allBlocked} title="Ignora o cache e chama a IA de novo">
                        <RotateCcw /> Gerar de novo
                      </Button>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
          {estimate.data && (
            <ul className="space-y-0.5 text-xs text-muted-foreground">
              {estimate.data.steps.map((s, i) => (
                <li key={s.provider + s.model} className={cn(s.blocked && "text-destructive")}>
                  {estimate.data!.steps.length > 1 && (i === 0 ? "Principal: " : "Alternativa autorizada: ")}
                  {s.label} · {s.model} · {s.blocked ? s.blocked.message : s.estimate.known ? `até ${usd(s.estimate.usd!)} (limite ${usd(estimate.data!.limitUsd)})` : "custo desconhecido"}
                </li>
              ))}
            </ul>
          )}
          {estimate.error && <p className="text-xs text-destructive">{errorMessage(estimate.error)}</p>}
        </div>
      )}

      {current && <AnalysisView key={current.id} analysis={current} canEdit={canRun} companyId={companyId} />}

      {list.length > 1 && (
        <div className="mt-6 border-t pt-4">
          <h3 className="mb-2 inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <History className="size-3.5" /> Histórico
          </h3>
          <ul className="flex flex-wrap gap-2">
            {list.map((a) => (
              <li key={a.id}>
                <Button size="sm" variant={a.id === current?.id ? "secondary" : "ghost"} onClick={() => setSelectedId(a.id)}>
                  {fmtDateTime(a.generatedAt)} · {a.status === "FAILED" ? "falhou" : (a.providerLabel ?? "IA")}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </SectionCard>
  );
}

function AnalysisView({ analysis: a, canEdit, companyId }: { analysis: Analysis; canEdit: boolean; companyId: string }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useSyncedState(a, (x) => x.editedMessage ?? x.personalizedMessage ?? "");
  const ref = useRef<HTMLTextAreaElement>(null);
  const save = useMutation({
    mutationFn: (editedMessage: string | null) => api<Analysis>(`/ai-analyses/${a.id}`, { method: "PATCH", body: { editedMessage } }),
    onSuccess: () => {
      toast.success("Mensagem salva");
      qc.invalidateQueries({ queryKey: ["ai-analyses", companyId] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(draft);
    } catch {
      ref.current?.select();
      if (!document.execCommand("copy")) return toast.error("Não foi possível copiar. Selecione o texto e copie manualmente.");
    }
    toast.success("Mensagem copiada", { description: "Envie você mesmo, de forma individual." });
  };

  if (a.status === "FAILED") {
    return (
      <div role="alert" className="mt-5 rounded-lg border border-destructive/20 bg-danger-soft/60 p-4 text-sm">
        <p className="font-medium">Não foi possível gerar a análise ({fmtDateTime(a.generatedAt)}).</p>
        <p className="mt-1 text-muted-foreground">{a.error}</p>
        <Attempts attempts={a.attempts} />
      </div>
    );
  }
  const original = a.personalizedMessage ?? "";
  return (
    <div className="mt-5 grid gap-5 border-t pt-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">
          {a.providerLabel} · {a.model}
        </span>
        <span>{fmtDateTime(a.generatedAt)}</span>
        {a.confidence && <span>{CONFIDENCE[a.confidence]}</span>}
        <span>
          {a.tokenUsage.input ?? "?"} tokens de entrada · {a.tokenUsage.output ?? "?"} de saída
        </span>
        <span title={a.estimatedCost.basis ?? undefined}>{a.estimatedCost.usd != null ? usd(a.estimatedCost.usd) : "custo desconhecido"}</span>
        {a.cached && <Badge variant="outline">reaproveitada</Badge>}
      </div>
      {a.notes.map((n) => (
        <p key={n} className="rounded-md bg-info-soft px-3 py-2 text-xs text-info">
          {n}
        </p>
      ))}
      {a.attempts.some((x) => !x.ok) && <Attempts attempts={a.attempts} />}

      <Block title="A. Resumo comercial">
        <p className="text-sm text-pretty">{a.summary}</p>
      </Block>
      <Block title="B. Evidências verificadas">
        {a.verifiedFacts.length ? (
          <ul className="space-y-1.5 text-sm">
            {a.verifiedFacts.map((f) => (
              <li key={f.fact}>
                {f.fact}
                <span className="ml-1 text-[11px] text-muted-foreground">
                  ({f.evidence.map((e, i) => (
                    <span key={e.id}>
                      {i > 0 && "; "}
                      <SourceLink source={e.source} url={e.sourceUrl} date={e.observedAt} />
                    </span>
                  ))}
                  )
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Nenhum fato com evidência.</p>
        )}
      </Block>
      <Block title="C. Hipóteses de oportunidade">
        <ul className="space-y-2 text-sm">
          {a.opportunityHypotheses.map((h) => (
            <li key={h.hypothesis}>
              <Badge variant="outline" className="mr-1.5">
                Hipótese · {CONFIDENCE[h.confidence] ?? h.confidence}
              </Badge>
              {h.hypothesis}
              <p className="text-xs text-muted-foreground">{h.basis}</p>
            </li>
          ))}
        </ul>
      </Block>
      <Block title="D. Perguntas de diagnóstico">
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          {a.diagnosticQuestions.map((q) => (
            <li key={q}>{q}</li>
          ))}
        </ol>
      </Block>
      <Block title="E. Mensagem personalizada" hint="Sugestão para revisar e enviar você mesmo. Nada é enviado pelo sistema.">
        <Textarea ref={ref} value={draft} onChange={(e) => setDraft(e.target.value)} rows={5} readOnly={!canEdit} aria-label="Mensagem personalizada" />
        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={copy}>
            <Copy /> Copiar
          </Button>
          {canEdit && (
            <Button size="sm" onClick={() => save.mutate(draft.trim() === original.trim() ? null : draft.trim())} disabled={save.isPending || !draft.trim() || draft === (a.editedMessage ?? original)}>
              <Save /> Salvar revisão
            </Button>
          )}
          {canEdit && a.editedMessage && (
            <Button size="sm" variant="ghost" onClick={() => save.mutate(null)}>
              <RotateCcw /> Voltar à sugestão original
            </Button>
          )}
        </div>
        {a.editedMessage && <p className="mt-1 text-[11px] text-muted-foreground">Revisada por uma pessoa. A sugestão original da IA continua guardada.</p>}
      </Block>
      <Block title="F. Objeções possíveis">
        <ul className="space-y-2 text-sm">
          {a.possibleObjections.map((o) => (
            <li key={o.objection}>
              <span className="font-medium">“{o.objection}”</span>
              <p className="text-muted-foreground">{o.response}</p>
            </li>
          ))}
        </ul>
      </Block>
      {a.recommendedNextAction && (
        <Block title="G. Próxima ação recomendada">
          <p className="text-sm font-medium">{NEXT_ACTION[a.recommendedNextAction.action] ?? a.recommendedNextAction.action}</p>
          <p className="text-sm text-muted-foreground">{a.recommendedNextAction.rationale}</p>
        </Block>
      )}
      {a.limitations.length > 0 && (
        <Block title="Limitações">
          <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
            {a.limitations.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </Block>
      )}
    </div>
  );
}

function Block({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-sm font-semibold">{title}</h3>
      {hint && <p className="mb-1.5 text-xs text-muted-foreground">{hint}</p>}
      <div className={cn(!hint && "mt-1.5")}>{children}</div>
    </section>
  );
}

function Attempts({ attempts }: { attempts: Analysis["attempts"] }) {
  return (
    <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
      {attempts.map((t, i) => (
        <li key={i}>
          {t.ok ? "✓" : "✗"} {t.provider} · {t.model}
          {t.error ? ` — ${t.error}` : ""}
        </li>
      ))}
    </ul>
  );
}
