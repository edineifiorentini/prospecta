"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, KeyRound, Loader2, PlugZap, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SectionCard } from "@/components/page";
import { api, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useSyncedState } from "@/lib/hooks";
import { cn } from "@/lib/utils";

type ProviderId = "openai" | "anthropic" | "xai" | "gemini" | "groq";
type AiSettings = {
  enabled: boolean;
  mode: "manual" | "auto";
  primaryProvider: ProviderId | null;
  fallbackProviders: ProviderId[];
  autoPolicy: "priority" | "lowest_cost";
  models: Partial<Record<ProviderId, string>>;
  offering: string;
  maxCostUsdPerAnalysis: number;
  allowUnknownCost: boolean;
  maxOutputTokens: number;
  timeoutSeconds: number;
  maxRetries: number;
  cacheDays: number;
};
type Intelligence = { targetSegments: string[]; criteriaWeights: Record<string, number>; indicatorWeights: { FIT: number; OPPORTUNITY: number; RELIABILITY: number }; thresholds: { a: number; b: number; minReliability: number; minCoverage: number } };
type Price = { input: number; output: number; verifiedAt: string; source: string; validUntil?: string; note?: string };
type Data = {
  settings: AiSettings;
  intelligence: Intelligence;
  providers: { id: ProviderId; label: string; keyEnv: string; configured: boolean; defaultModel: string; suggestedModels: string[] }[];
  pricing: Record<ProviderId, Record<string, Price>>;
  segments: { id: string; label: string }[];
  methodology: string;
};
type TestResult = { ok: boolean; code: string | null; message: string; detail?: string | null; models: string[] };

const brl = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function AiSettingsPanel() {
  const qc = useQueryClient();
  const { can } = useSession();
  const editable = can("settings:manage");
  const q = useQuery({ queryKey: ["ai-settings"], queryFn: () => api<Data>("/ai/settings") });
  const [form, setForm] = useSyncedState(q.data, (d) => d?.settings ?? null);
  const [intel, setIntel] = useSyncedState(q.data, (d) => d?.intelligence ?? null);
  const [tests, setTests] = useState<Partial<Record<ProviderId, TestResult | "loading">>>({});

  const save = useMutation({
    mutationFn: async () => {
      await api("/ai/settings", { method: "PUT", body: form });
      await api("/org", { method: "PATCH", body: { settings: { intelligence: intel } } });
    },
    onSuccess: () => {
      toast.success("Configuração salva");
      qc.invalidateQueries({ queryKey: ["ai-settings"] });
      qc.invalidateQueries({ queryKey: ["intelligence"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const test = async (id: ProviderId) => {
    setTests((t) => ({ ...t, [id]: "loading" }));
    try {
      const r = await api<TestResult>(`/ai/providers/${id}/test`, { method: "POST" });
      setTests((t) => ({ ...t, [id]: r }));
    } catch (e) {
      setTests((t) => ({ ...t, [id]: { ok: false, code: "ERRO", message: errorMessage(e), models: [] } }));
    }
  };

  if (!q.data || !form || !intel) return null;
  const d = q.data;
  const set = <K extends keyof AiSettings>(k: K, v: AiSettings[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));
  const num = (k: "maxCostUsdPerAnalysis" | "maxOutputTokens" | "timeoutSeconds" | "maxRetries" | "cacheDays", v: string) => set(k, Number(v));

  return (
    <div className="grid gap-6">
      <SectionCard
        title="Inteligência artificial"
        description="Análise Comercial com IA na ficha de cada empresa. Desligada até você ativar; cada análise só roda quando alguém clica em gerar."
        actions={<Switch checked={form.enabled} onCheckedChange={(v) => set("enabled", v)} disabled={!editable} aria-label="Ativar análise com IA" />}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div className="grid gap-1.5">
            <Label>Escolha do provedor</Label>
            <Select value={form.mode} onValueChange={(v) => set("mode", v as AiSettings["mode"])} disabled={!editable}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="manual">Manual: usa só o provedor principal</SelectItem>
                <SelectItem value="auto">Alternância automática entre os autorizados</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {form.mode === "manual" ? "Se o provedor falhar, a análise falha e nada é trocado." : "Se o principal falhar, tenta as alternativas marcadas abaixo. Toda troca aparece na análise."}
            </p>
          </div>
          {form.mode === "auto" && (
            <div className="grid gap-1.5">
              <Label>Ordem das tentativas</Label>
              <Select value={form.autoPolicy} onValueChange={(v) => set("autoPolicy", v as AiSettings["autoPolicy"])} disabled={!editable}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="priority">Prioridade: principal primeiro</SelectItem>
                  <SelectItem value="lowest_cost">Menor custo estimado primeiro</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid gap-1.5 md:col-span-2">
            <Label htmlFor="ai-offering">O que você vende</Label>
            <Textarea id="ai-offering" rows={2} value={form.offering} onChange={(e) => set("offering", e.target.value)} disabled={!editable} />
            <p className="text-xs text-muted-foreground">Vai para a IA para personalizar a abordagem.</p>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Provedores" description="Só OpenAI, Claude, Grok, Gemini e Groq, pelas APIs oficiais. O teste de conexão lista os modelos e não consome tokens." bodyClassName="p-0">
        <ul className="divide-y">
          {d.providers.map((p) => {
            const t = tests[p.id];
            const tested = t && t !== "loading" ? t : null;
            const model = form.models[p.id] ?? p.defaultModel;
            const price = d.pricing[p.id]?.[model];
            const options = [...new Set([model, ...p.suggestedModels, ...(tested?.models ?? [])])];
            const isPrimary = form.primaryProvider === p.id;
            return (
              <li key={p.id} className="grid gap-3 px-5 py-4 xl:grid-cols-[minmax(0,1fr)_300px_auto] xl:items-center">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold">{p.label}</span>
                    {p.configured ? <Badge variant="secondary">Chave configurada</Badge> : <Badge variant="outline">Sem chave</Badge>}
                    {isPrimary && <Badge>Principal</Badge>}
                  </div>
                  {!p.configured && (
                    <p className="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                      <KeyRound className="size-3" /> Defina <code className="font-mono">{p.keyEnv}</code> no servidor para ativar.
                    </p>
                  )}
                  {tested && (
                    <p className={cn("mt-1 flex items-center gap-1 text-xs", tested.ok ? "text-success" : "text-destructive")}>
                      {tested.ok ? <CheckCircle2 className="size-3.5" /> : <XCircle className="size-3.5" />} {tested.message}
                    </p>
                  )}
                  {tested && !tested.ok && tested.detail && <p className="mt-0.5 break-words text-xs text-muted-foreground">Resposta do provedor: {tested.detail}</p>}
                  <div className="mt-2 flex flex-wrap gap-4 text-xs">
                    <label className="inline-flex items-center gap-1.5">
                      <input type="radio" name="primary" checked={isPrimary} disabled={!editable} onChange={() => setForm((f) => (f ? { ...f, primaryProvider: p.id, fallbackProviders: f.fallbackProviders.filter((x) => x !== p.id) } : f))} />
                      Provedor principal
                    </label>
                    {form.mode === "auto" && !isPrimary && (
                      <label className="inline-flex items-center gap-1.5">
                        <Checkbox
                          checked={form.fallbackProviders.includes(p.id)}
                          disabled={!editable}
                          onCheckedChange={(v) => set("fallbackProviders", v ? [...form.fallbackProviders, p.id] : form.fallbackProviders.filter((x) => x !== p.id))}
                        />
                        Alternativa autorizada
                      </label>
                    )}
                  </div>
                </div>
                <div className="grid gap-1">
                  <Select value={model} onValueChange={(v) => set("models", { ...form.models, [p.id]: v })} disabled={!editable}>
                    <SelectTrigger aria-label={`Modelo de ${p.label}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {options.map((m) => (
                        <SelectItem key={m} value={m}>
                          {m}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <span className="text-[11px] text-muted-foreground">
                    {price ? `US$ ${brl(price.input)} entrada / ${brl(price.output)} saída por milhão de tokens · conferido em ${price.verifiedAt.split("-").reverse().join("/")}${price.note ? ` · ${price.note}` : ""}` : "Preço não confirmado: custo desconhecido"}
                  </span>
                </div>
                <Button variant="outline" size="sm" className="justify-self-start xl:justify-self-end" onClick={() => test(p.id)} disabled={!editable || !p.configured || t === "loading"}>
                  {t === "loading" ? <Loader2 className="animate-spin" /> : <PlugZap />} Testar conexão
                </Button>
              </li>
            );
          })}
        </ul>
      </SectionCard>

      <SectionCard title="Limites de consumo" description="Conferidos antes de cada chamada. A estimativa usa o pior caso (todo o limite de saída).">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Custo máximo por análise (US$)" hint="Acima disso, a análise não é enviada.">
            <Input type="number" step="0.01" min={0.001} max={5} value={form.maxCostUsdPerAnalysis} onChange={(e) => num("maxCostUsdPerAnalysis", e.target.value)} disabled={!editable} />
          </Field>
          <Field label="Tokens de saída (máximo)" hint="Inclui o raciocínio dos modelos que pensam antes de responder.">
            <Input type="number" min={1000} max={32000} step={500} value={form.maxOutputTokens} onChange={(e) => num("maxOutputTokens", e.target.value)} disabled={!editable} />
          </Field>
          <Field label="Tempo limite (segundos)">
            <Input type="number" min={10} max={300} value={form.timeoutSeconds} onChange={(e) => num("timeoutSeconds", e.target.value)} disabled={!editable} />
          </Field>
          <Field label="Tentativas extras" hint="Só para erros temporários (limite, rede, formato).">
            <Input type="number" min={0} max={3} value={form.maxRetries} onChange={(e) => num("maxRetries", e.target.value)} disabled={!editable} />
          </Field>
          <Field label="Reaproveitar análise por (dias)" hint="Mesmos dados, mesmo modelo: não chama a IA de novo.">
            <Input type="number" min={0} max={90} value={form.cacheDays} onChange={(e) => num("cacheDays", e.target.value)} disabled={!editable} />
          </Field>
          <Field label="Modelos sem preço confirmado" hint="Desligado: bloqueia modelos com custo desconhecido.">
            <div className="flex h-9 items-center">
              <Switch checked={form.allowUnknownCost} onCheckedChange={(v) => set("allowUnknownCost", v)} disabled={!editable} aria-label="Permitir custo desconhecido" />
            </div>
          </Field>
        </div>
      </SectionCard>

      <SectionCard title="Perfil de cliente ideal" description={`Usado nos indicadores da ficha (metodologia ${d.methodology}).`}>
        <div className="grid gap-5 md:grid-cols-2">
          <div>
            <Label className="mb-2 block">Segmentos-alvo</Label>
            <div className="grid gap-2">
              {d.segments.map((s) => (
                <label key={s.id} className="inline-flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={intel.targetSegments.includes(s.id)}
                    disabled={!editable}
                    onCheckedChange={(v) => setIntel((x) => (x ? { ...x, targetSegments: v ? [...x.targetSegments, s.id] : x.targetSegments.filter((y) => y !== s.id) } : x))}
                  />
                  {s.label}
                </label>
              ))}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                ["FIT", "Peso: aderência"],
                ["OPPORTUNITY", "Peso: oportunidade"],
                ["RELIABILITY", "Peso: confiabilidade"],
              ] as const
            ).map(([k, label]) => (
              <Field key={k} label={label}>
                <Input type="number" min={0} max={100} value={intel.indicatorWeights[k]} disabled={!editable} onChange={(e) => setIntel((x) => (x ? { ...x, indicatorWeights: { ...x.indicatorWeights, [k]: Number(e.target.value) } } : x))} />
              </Field>
            ))}
            <Field label="Prioridade A a partir de">
              <Input type="number" min={1} max={100} value={intel.thresholds.a} disabled={!editable} onChange={(e) => setIntel((x) => (x ? { ...x, thresholds: { ...x.thresholds, a: Number(e.target.value) } } : x))} />
            </Field>
            <Field label="Prioridade B a partir de">
              <Input type="number" min={1} max={100} value={intel.thresholds.b} disabled={!editable} onChange={(e) => setIntel((x) => (x ? { ...x, thresholds: { ...x.thresholds, b: Number(e.target.value) } } : x))} />
            </Field>
            <Field label="Confiabilidade mínima" hint="Abaixo disso: “Necessita qualificação”.">
              <Input type="number" min={0} max={100} value={intel.thresholds.minReliability} disabled={!editable} onChange={(e) => setIntel((x) => (x ? { ...x, thresholds: { ...x.thresholds, minReliability: Number(e.target.value) } } : x))} />
            </Field>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Segurança das chaves">
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>As chaves ficam só nas variáveis de ambiente do servidor. Nunca aparecem no navegador, nos registros ou no Git.</li>
          <li>Todas as contas desta instalação usam as mesmas chaves; cada conta define seus limites e o que pode ser usado.</li>
          <li>Chaves próprias por cliente ainda não são aceitas: dependem de armazenamento cifrado e separado por conta.</li>
          <li>Telefones, e-mails e nomes de perfis não são enviados à IA. Conteúdo de sites vai marcado como não confiável.</li>
        </ul>
      </SectionCard>

      {editable && (
        <div className="flex justify-end">
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending && <Loader2 className="animate-spin" />} Salvar configuração
          </Button>
        </div>
      )}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
