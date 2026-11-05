"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Coins, ExternalLink, FlaskConical, KeyRound, Loader2, Trash2 } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { SectionCard } from "@/components/page";
import { api, errorMessage } from "@/lib/api";
import { fmtDate, fmtNumber } from "@/lib/format";
import { useSession } from "@/lib/session";
import { useSyncedState } from "@/lib/hooks";

type Bucket = "cadastro" | "estrategico" | "perfilNegocio" | "contatosBasicos" | "contatosAvancados";
type Settings = {
  enabled: boolean;
  autoEnrich: boolean;
  autoEnrichMaxPerSearch: number;
  buckets: Bucket[];
  minMatchConfidence: number;
  maxTokensPerCall: number;
  maxDailyRequests: number;
  maxDailyTokens: number;
  cacheDays: number;
  maxBatchSize: number;
};
type View = {
  settings: Settings;
  credential: { hasKey: boolean; keyHint: string | null; updatedAt: string | null };
  simulated: boolean;
  configured: boolean;
  usage: { requests: number; tokens: number };
  provider: { label: string; docs: string };
};

const BUCKETS: { id: Bucket; label: string; hint: string; personal?: boolean }[] = [
  { id: "cadastro", label: "Cadastro (obrigatório)", hint: "Razão social, situação, CNAEs, abertura, endereço e capital social: dados da Receita que identificam e validam a empresa." },
  { id: "estrategico", label: "Dimensionamento", hint: "Faixas de funcionários e de faturamento (muitas vezes estimadas pelo fornecedor) e tecnologias." },
  { id: "perfilNegocio", label: "Perfil de negócio", hint: "Porte, comércio exterior (anos com registro), grupo matriz/filiais e tendência do setor." },
  { id: "contatosBasicos", label: "Contatos", hint: "Telefones (com indicação de WhatsApp) e e-mails da empresa.", personal: true },
  { id: "contatosAvancados", label: "Decisores", hint: "Nomes e cargos de decisores: dados pessoais.", personal: true },
];

export function BusinessDataSettings() {
  const qc = useQueryClient();
  const { can } = useSession();
  const editable = can("settings:manage");
  const q = useQuery({ queryKey: ["business-data-settings"], queryFn: () => api<View>("/business-data/settings") });
  const [form, setForm] = useSyncedState(q.data, (d) => d?.settings ?? null);
  const [key, setKey] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);
  const done = () => qc.invalidateQueries({ queryKey: ["business-data-settings"] });

  const save = useMutation({
    mutationFn: () => api("/business-data/settings", { method: "PUT", body: form }),
    onSuccess: () => {
      toast.success("Configuração salva");
      done();
      qc.invalidateQueries({ queryKey: ["business-data"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const saveKey = useMutation({
    mutationFn: () => api<View & { balance: number }>("/business-data/credential", { method: "PUT", body: { apiKey: key.trim() } }),
    onSuccess: (r) => {
      toast.success(`Chave validada e salva · saldo de ${fmtNumber(r.balance)} tokens`);
      setKey("");
      setBalance(r.balance);
      done();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const removeKey = useMutation({
    mutationFn: () => api("/business-data/credential", { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Chave removida");
      setConfirmRemove(false);
      setBalance(null);
      done();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const checkBalance = useMutation({
    mutationFn: () => api<{ tokens: number; simulated: boolean }>("/business-data/balance"),
    onSuccess: (r) => setBalance(r.tokens),
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (!q.data || !form) return null;
  const v = q.data;
  const set = <K extends keyof Settings>(k: K, val: Settings[K]) => setForm((f) => (f ? { ...f, [k]: val } : f));
  const num = (k: "autoEnrichMaxPerSearch" | "maxTokensPerCall" | "maxDailyRequests" | "maxDailyTokens" | "cacheDays" | "maxBatchSize", val: string) => set(k, Number(val));

  return (
    <div className="grid gap-6">
      <SectionCard
        title="Dados empresariais"
        description="Enriquecimento pago pela Econodata (API v4): cadastro oficial, porte, funcionários, faturamento estimado e comércio exterior. Desligado até você ativar; nada é consultado sozinho."
        actions={<Switch checked={form.enabled} onCheckedChange={(x) => set("enabled", x)} disabled={!editable} aria-label="Ativar dados empresariais" />}
      >
        <div className="grid gap-2 text-sm text-muted-foreground">
          <p>
            Fluxo: coleta gratuita → identificação (CNPJ já validado, ou site, telefone e e-mail) → validação de UF e cidade → consulta paga só da empresa escolhida. Antes de cada consulta, o fornecedor informa o custo sem cobrar. Nenhum CNPJ é vinculado por semelhança de nome.
          </p>
          <a href={v.provider.docs} target="_blank" rel="noopener noreferrer" className="inline-flex w-fit items-center gap-1 text-foreground underline underline-offset-2">
            Documentação da API <ExternalLink className="size-3" />
          </a>
          {v.simulated && (
            <p className="flex items-center gap-1.5 rounded-md bg-warning-soft px-2.5 py-1.5 text-xs text-[color-mix(in_oklch,var(--warning),black_35%)] dark:text-warning">
              <FlaskConical className="size-3.5" /> Modo simulado ligado neste servidor (só fora de produção): os dados são de teste e nada é cobrado.
            </p>
          )}
        </div>
      </SectionCard>

      <SectionCard title="Chave da Econodata" description="Cada conta usa a própria chave. Ela fica cifrada no servidor e nunca volta para o navegador.">
        <div className="grid gap-3">
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <KeyRound className="size-4 text-muted-foreground" />
            {v.credential.hasKey ? (
              <>
                <Badge variant="secondary">Chave cadastrada</Badge> termina em <code className="font-mono">…{v.credential.keyHint}</code>
                {v.credential.updatedAt && <span className="text-muted-foreground">· validada em {fmtDate(v.credential.updatedAt)}</span>}
              </>
            ) : (
              <Badge variant="outline">Sem chave</Badge>
            )}
            {balance != null && (
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                <Coins className="size-3.5" /> saldo: {fmtNumber(balance)} tokens
              </span>
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
              <Input
                type="password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="ek_live_…"
                aria-label="Chave da Econodata"
                autoComplete="new-password"
                spellCheck={false}
                data-1p-ignore
                data-lpignore="true"
                className="h-8 max-w-sm flex-1 font-mono text-xs"
              />
              <Button type="submit" size="sm" disabled={!key.trim() || saveKey.isPending}>
                {saveKey.isPending && <Loader2 className="animate-spin" />} Validar e salvar
              </Button>
              {v.configured && (
                <Button type="button" size="sm" variant="outline" onClick={() => checkBalance.mutate()} disabled={checkBalance.isPending}>
                  {checkBalance.isPending ? <Loader2 className="animate-spin" /> : <Coins />} Ver saldo
                </Button>
              )}
              {v.credential.hasKey && (
                <Button type="button" size="sm" variant="ghost" className="text-destructive" onClick={() => setConfirmRemove(true)}>
                  <Trash2 /> Remover
                </Button>
              )}
            </form>
          )}
          <p className="text-xs text-muted-foreground">
            A chave é gerada em plat.econodata.com.br › Chaves e Integrações (contas com a API v4 liberada). A validação usa o endpoint de saldo, que não cobra. Chaves de teste (trial) são só de leitura.
          </p>
        </div>
      </SectionCard>

      <SectionCard title="O que consultar" description="Cada bloco tem custo próprio em tokens. Peça só o que vai usar.">
        <div className="grid gap-3">
          {BUCKETS.map((b) => (
            <label key={b.id} className="flex items-start gap-2.5 text-sm">
              <Checkbox
                checked={form.buckets.includes(b.id)}
                disabled={!editable || b.id === "cadastro"}
                onCheckedChange={(x) => set("buckets", x ? [...form.buckets, b.id] : form.buckets.filter((y) => y !== b.id))}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium">{b.label}</span>
                {b.personal && <Badge variant="outline" className="ml-2 text-[10px]">dados pessoais (LGPD)</Badge>}
                <span className="block text-xs text-muted-foreground">{b.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Limites de consumo" description={`Conferidos antes de cada consulta paga. Hoje: ${fmtNumber(v.usage.requests)} consulta(s) e ${fmtNumber(v.usage.tokens)} tokens.`}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Máximo de tokens por consulta" hint="Acima disso (pela prévia do fornecedor), a consulta não é feita.">
            <Input type="number" min={1} value={form.maxTokensPerCall} onChange={(e) => num("maxTokensPerCall", e.target.value)} disabled={!editable} />
          </Field>
          <Field label="Consultas pagas por dia">
            <Input type="number" min={1} value={form.maxDailyRequests} onChange={(e) => num("maxDailyRequests", e.target.value)} disabled={!editable} />
          </Field>
          <Field label="Tokens por dia">
            <Input type="number" min={1} value={form.maxDailyTokens} onChange={(e) => num("maxDailyTokens", e.target.value)} disabled={!editable} />
          </Field>
          <Field label="Reaproveitar consulta por (dias)" hint="Dentro do prazo, a ficha usa os dados guardados, sem nova cobrança.">
            <Input type="number" min={0} max={365} value={form.cacheDays} onChange={(e) => num("cacheDays", e.target.value)} disabled={!editable} />
          </Field>
          <Field label="Empresas por lote">
            <Input type="number" min={1} max={100} value={form.maxBatchSize} onChange={(e) => num("maxBatchSize", e.target.value)} disabled={!editable} />
          </Field>
          <Field label="Confiança mínima para vincular sozinho (%)" hint="Abaixo disso, ou se casar só pelo nome, uma pessoa confirma.">
            <Input type="number" min={50} max={100} value={Math.round(form.minMatchConfidence * 100)} onChange={(e) => set("minMatchConfidence", Number(e.target.value) / 100)} disabled={!editable} />
          </Field>
        </div>
      </SectionCard>

      <SectionCard title="Enriquecimento automático" description="Depois de cada busca, consulta sozinho as empresas novas que já têm CNPJ ou site. Gera custo: deixe desligado se não tiver certeza." actions={<Switch checked={form.autoEnrich} onCheckedChange={(x) => set("autoEnrich", x)} disabled={!editable} aria-label="Enriquecimento automático" />}>
        <Field label="Máximo de empresas por busca">
          <Input type="number" min={1} max={100} value={form.autoEnrichMaxPerSearch} onChange={(e) => num("autoEnrichMaxPerSearch", e.target.value)} disabled={!editable || !form.autoEnrich} className="max-w-40" />
        </Field>
      </SectionCard>

      {editable && (
        <div className="flex justify-end">
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending && <Loader2 className="animate-spin" />} Salvar configuração
          </Button>
        </div>
      )}

      <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover a chave da Econodata?</AlertDialogTitle>
            <AlertDialogDescription>A chave é apagada desta conta na hora. Os dados já consultados continuam nas fichas; novas consultas param até uma nova chave ser cadastrada.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={removeKey.isPending}
              onClick={(e) => {
                e.preventDefault();
                removeKey.mutate();
              }}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              Remover chave
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
