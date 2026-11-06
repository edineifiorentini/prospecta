"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ExternalLink, FlaskConical, KeyRound, Loader2, PlugZap, Save, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { SectionCard } from "@/components/page";
import { api, errorMessage } from "@/lib/api";
import { fmtDateTime, fmtNumber, fmtRelative } from "@/lib/format";
import { useSession } from "@/lib/session";

type Config = { enabled: boolean; concurrency: number; cacheDays: number; maxDailyRequests: number; scheduled: boolean };
type Run = { createdAt: string; ok?: boolean; operation?: string; errorCode?: string | null; error?: string | null; mock: boolean };
type Source = {
  id: string;
  name: string;
  kind: string;
  scope: "company" | "regional" | "catalog";
  access: "api" | "api_chave_gratuita" | "arquivo_local";
  credentialUrl?: string;
  docsUrl: string;
  existing?: boolean;
  ratePerMinute: number;
  description: string;
  caveat: string;
  config: Config;
  credential: { hasKey: boolean; keyHint: string | null; updatedAt: string | null } | null;
  usageToday: number;
  lastRun: Run | null;
  lastOk: Run | null;
  runs30d: number;
  failures30d: number;
  recentErrors: Run[];
  localBase: { records: number; lastImport: { kind: string; file: string; status: string; linesImported: number; finishedAt: string | null } | null } | null;
};
type View = { simulated: boolean; econodata: { enabled: boolean }; sources: Source[] };
type TestResult = { ok: boolean; message: string; simulated: boolean; durationMs: number };

const KIND: Record<string, string> = {
  identificacao: "Identificação",
  cadastral: "Cadastro oficial",
  digital: "Análise digital",
  contratacoes: "Contratações públicas",
  economico: "Indicadores econômicos",
  emprego: "Emprego",
  comercio_exterior: "Comércio exterior",
  financeiro: "Financeiro",
};
const SCOPE: Record<Source["scope"], string> = { company: "dado da empresa", regional: "dado do município", catalog: "catálogo público" };
const ACCESS: Record<Source["access"], string> = { api: "API pública", api_chave_gratuita: "API com chave gratuita", arquivo_local: "arquivo oficial importado" };

/** Estado mostrado: ativa, desativada ou pendente de configuração (chave ou base local faltando). */
function stateOf(s: Source, simulated: boolean): { label: string; variant: "default" | "secondary" | "outline" } {
  if (!s.config.enabled) return { label: "Desativada", variant: "outline" };
  if (s.access === "api_chave_gratuita" && !s.credential?.hasKey && !simulated) return { label: "Pendente: falta a chave", variant: "secondary" };
  if (s.access === "arquivo_local" && !s.localBase?.records) return { label: "Pendente: base vazia", variant: "secondary" };
  return { label: "Ativa", variant: "default" };
}

export function IntegrationsSettings() {
  const q = useQuery({ queryKey: ["integrations"], queryFn: () => api<View>("/integrations") });
  if (!q.data) return null;
  const v = q.data;
  return (
    <div className="grid gap-6">
      <SectionCard
        title="Central de integrações"
        description="Fontes públicas e gratuitas que complementam a coleta. Cada uma começa desligada (exceto BrasilAPI e Lighthouse, que o Prospecta já usava) e pode ficar desligada sem afetar o resto."
      >
        <div className="grid gap-2 text-sm text-muted-foreground">
          <p>Dados de município (IBGE, Comex Stat, CAGED) aparecem só como indicadores regionais: nunca viram dado de uma empresa. Registros públicos só são ligados a uma empresa pelo CNPJ exato.</p>
          <p>
            Dados empresariais pagos (Econodata) ficam em <a href="?tab=dados" className="text-foreground underline underline-offset-2">Dados empresariais</a> · {v.econodata.enabled ? "ativos" : "desligados"}.
          </p>
          {v.simulated && (
            <p className="flex items-center gap-1.5 rounded-md bg-warning-soft px-2.5 py-1.5 text-xs text-[color-mix(in_oklch,var(--warning),black_35%)] dark:text-warning">
              <FlaskConical className="size-3.5" /> Modo simulado ligado neste servidor (só fora de produção): as fontes respondem com dados de teste, sem rede.
            </p>
          )}
        </div>
      </SectionCard>
      {v.sources.map((s) => (
        <SourceCard key={s.id} source={s} simulated={v.simulated} />
      ))}
    </div>
  );
}

function SourceCard({ source: s, simulated }: { source: Source; simulated: boolean }) {
  const qc = useQueryClient();
  const { can } = useSession();
  const editable = can("settings:manage");
  const [form, setForm] = useState<Config>(s.config);
  const [key, setKey] = useState("");
  const [test, setTest] = useState<TestResult | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["integrations"] });
  const dirty = JSON.stringify(form) !== JSON.stringify(s.config);

  const save = useMutation({
    mutationFn: (body: Partial<Config>) => api(`/integrations/${s.id}`, { method: "PUT", body }),
    onSuccess: () => {
      toast.success(`${s.name}: configuração salva`);
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const saveKey = useMutation({
    mutationFn: () => api(`/integrations/${s.id}/credential`, { method: "PUT", body: { apiKey: key.trim() } }),
    onSuccess: () => {
      toast.success("Chave salva (cifrada no servidor)");
      setKey("");
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const removeKey = useMutation({
    mutationFn: () => api(`/integrations/${s.id}/credential`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Chave removida");
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const runTest = useMutation({
    mutationFn: () => api<TestResult>(`/integrations/${s.id}/test`, { method: "POST" }),
    onSuccess: (r) => {
      setTest(r);
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const state = stateOf({ ...s, config: form }, simulated);
  const toggle = (enabled: boolean) => {
    setForm((f) => ({ ...f, enabled }));
    save.mutate({ enabled });
  };
  const num = (k: "concurrency" | "cacheDays" | "maxDailyRequests", val: string) => setForm((f) => ({ ...f, [k]: Number(val) }));

  return (
    <SectionCard
      title={
        <span className="flex flex-wrap items-center gap-2">
          {s.name}
          <Badge variant={state.variant}>{state.label}</Badge>
          {s.existing && <Badge variant="outline" className="text-[10px]">recurso existente</Badge>}
        </span>
      }
      description={`${KIND[s.kind] ?? s.kind} · ${SCOPE[s.scope]} · ${ACCESS[s.access]}`}
      actions={<Switch checked={form.enabled} onCheckedChange={toggle} disabled={!editable || save.isPending} aria-label={`Ativar ${s.name}`} />}
    >
      <div className="grid gap-4 text-sm">
        <div className="grid gap-1">
          <p>{s.description}</p>
          <p className="text-xs text-muted-foreground">{s.caveat}</p>
          <a href={s.docsUrl} target="_blank" rel="noopener noreferrer" className="inline-flex w-fit items-center gap-1 text-xs underline underline-offset-2">
            Documentação oficial <ExternalLink className="size-3" />
          </a>
        </div>

        <dl className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Última execução" value={s.lastRun ? `${fmtRelative(s.lastRun.createdAt)}${s.lastRun.ok ? "" : " (falhou)"}${s.lastRun.mock ? " · simulada" : ""}` : "Nenhuma ainda"} />
          <Stat label="Última com sucesso" value={s.lastOk ? fmtRelative(s.lastOk.createdAt) : "Nenhuma ainda"} />
          <Stat label="Execuções (30 dias)" value={`${fmtNumber(s.runs30d)}${s.failures30d ? ` · ${fmtNumber(s.failures30d)} com falha` : ""}`} />
          <Stat label="Consultas hoje" value={`${fmtNumber(s.usageToday)} de ${fmtNumber(form.maxDailyRequests)}`} />
          {s.localBase && <Stat label="Base local" value={s.localBase.records ? `${fmtNumber(s.localBase.records)} registro(s)` : "Vazia: importe os arquivos"} />}
          {s.localBase?.lastImport && <Stat label="Última importação" value={`${s.localBase.lastImport.file} · ${s.localBase.lastImport.status}`} />}
          <Stat label="Limite da fonte" value={`até ${s.ratePerMinute} req./min`} />
        </dl>

        {s.recentErrors.length > 0 && (
          <details className="rounded-md border px-3 py-2 text-xs">
            <summary className="cursor-pointer font-medium">Erros recentes ({s.recentErrors.length})</summary>
            <ul className="mt-2 grid gap-1 text-muted-foreground">
              {s.recentErrors.map((e) => (
                <li key={e.createdAt}>
                  {fmtDateTime(e.createdAt)} · {e.errorCode}
                  {e.error ? `: ${e.error}` : ""}
                  {e.mock ? " (simulado)" : ""}
                </li>
              ))}
            </ul>
          </details>
        )}

        {s.access === "api_chave_gratuita" && (
          <div className="grid gap-2 rounded-md border px-3 py-3">
            <p className="flex flex-wrap items-center gap-2">
              <KeyRound className="size-4 text-muted-foreground" />
              {s.credential?.hasKey ? (
                <>
                  <Badge variant="secondary">Chave cadastrada</Badge> termina em <code className="font-mono">…{s.credential.keyHint}</code>
                </>
              ) : (
                <Badge variant="outline">Sem chave</Badge>
              )}
              {s.credentialUrl && (
                <a href={s.credentialUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs underline underline-offset-2">
                  Obter chave gratuita <ExternalLink className="size-3" />
                </a>
              )}
            </p>
            {editable && (
              <form
                className="flex flex-wrap gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (key.trim()) saveKey.mutate();
                }}
              >
                <Input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Cole a chave gratuita" aria-label={`Chave de ${s.name}`} autoComplete="new-password" spellCheck={false} data-1p-ignore data-lpignore="true" className="h-8 max-w-sm flex-1 font-mono text-xs" />
                <Button type="submit" size="sm" disabled={!key.trim() || saveKey.isPending}>
                  {saveKey.isPending && <Loader2 className="animate-spin" />} Salvar chave
                </Button>
                {s.credential?.hasKey && (
                  <Button type="button" size="sm" variant="ghost" className="text-destructive" onClick={() => removeKey.mutate()} disabled={removeKey.isPending}>
                    <Trash2 /> Remover
                  </Button>
                )}
              </form>
            )}
            <p className="text-xs text-muted-foreground">Cada conta usa a própria chave. Ela fica cifrada no servidor e nunca volta para o navegador.</p>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Consultas por dia (esta conta)">
            <Input type="number" min={1} value={form.maxDailyRequests} onChange={(e) => num("maxDailyRequests", e.target.value)} disabled={!editable} />
          </Field>
          <Field label="Reaproveitar resultado por (dias)">
            <Input type="number" min={0} max={365} value={form.cacheDays} onChange={(e) => num("cacheDays", e.target.value)} disabled={!editable} />
          </Field>
          <Field label="Execuções simultâneas">
            <Input type="number" min={1} max={5} value={form.concurrency} onChange={(e) => num("concurrency", e.target.value)} disabled={!editable} />
          </Field>
          {s.id === "pncp" && (
            <Field label="Sincronizar todo dia às 6h">
              <Switch checked={form.scheduled} onCheckedChange={(x) => setForm((f) => ({ ...f, scheduled: x }))} disabled={!editable} aria-label="Sincronização diária" />
            </Field>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {editable && (
            <Button size="sm" variant="outline" onClick={() => runTest.mutate()} disabled={runTest.isPending}>
              {runTest.isPending ? <Loader2 className="animate-spin" /> : <PlugZap />} Testar
            </Button>
          )}
          {editable && dirty && (
            <Button size="sm" onClick={() => save.mutate(form)} disabled={save.isPending}>
              {save.isPending ? <Loader2 className="animate-spin" /> : <Save />} Salvar limites
            </Button>
          )}
          {test && (
            <span className={test.ok ? "text-xs text-success" : "text-xs text-destructive"}>
              {test.message}
              {test.simulated ? " (simulado)" : ""} · {fmtNumber(test.durationMs)} ms
            </span>
          )}
        </div>
      </div>
    </SectionCard>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid content-start gap-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}
