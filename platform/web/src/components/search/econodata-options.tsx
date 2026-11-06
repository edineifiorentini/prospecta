"use client";

import { Controller, type Control, type FieldValues, type Path, type UseFormRegister } from "react-hook-form";
import { Building2, Calculator, Coins, Loader2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Field } from "@/components/form-field";
import { cn } from "@/lib/utils";

/** Resposta de POST /searches/econodata/preview (contagem + custo estimado; não traz empresas). */
export type EconodataPreview = {
  enabled: boolean;
  configured: boolean;
  simulated: boolean;
  total: number | null;
  willFetch: number;
  pages: number;
  tokensPerPage: number | null;
  tokensEstimated: number | null;
  countTokensCharged?: number;
  blocked: string | null;
  usage: { requests: number; tokens: number; maxDailyRequests: number; maxDailyTokens: number; maxTokensPerCall: number } | null;
};

export const SIZES = [
  { id: "INDIVIDUAL", label: "Individual (MEI)" },
  { id: "MICRO", label: "Micro" },
  { id: "PEQUENO", label: "Pequeno" },
  { id: "MEDIO", label: "Médio" },
  { id: "GRANDE", label: "Grande" },
] as const;

export const SEARCH_BUCKETS = [
  { id: "cadastro", label: "Cadastro oficial", hint: "razão social, CNAE, situação, endereço (sempre incluído)" },
  { id: "estrategico", label: "Porte estimado", hint: "funcionários e faturamento em faixas, tecnologias" },
  { id: "perfilNegocio", label: "Perfil do negócio", hint: "porte, grupo econômico, comércio exterior" },
  { id: "contatosBasicos", label: "Contatos básicos", hint: "telefones e e-mails (podem ser dados pessoais)" },
] as const;

const n = (v: number) => v.toLocaleString("pt-BR");

/** o formulário de busca tem o grupo `econodata` com estes campos */
type Props<T extends FieldValues> = {
  control: Control<T>;
  register: UseFormRegister<T>;
  allowedBuckets: string[];
  preview: EconodataPreview | null;
  stale: boolean;
  pending: boolean;
  onPreview: () => void;
};

export function EconodataOptions<T extends FieldValues>({ control, register, allowedBuckets, preview, stale, pending, onPreview }: Props<T>) {
  const at = (name: string) => name as Path<T>;
  return (
    <div className="grid gap-4 rounded-xl border bg-card p-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <Building2 className="size-4" />
        </span>
        <p className="text-[13px] text-muted-foreground">
          Busca na base da Econodata: empresas com CNPJ, filtradas pela cidade e pela palavra-chave. Cada empresa trazida consome tokens da sua conta; a prévia
          mostra quantas são e quanto custaria antes de buscar. Os dados de cada empresa já entram na ficha, em Dados empresariais.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="eco-scope" label="Onde procurar a palavra-chave">
          <div className="flex flex-wrap gap-4 pt-1 text-[13px]">
            {(
              [
                ["econodata.scopeName", "Nome da empresa"],
                ["econodata.scopeProducts", "Produtos e serviços"],
              ] as const
            ).map(([name, label]) => (
              <label key={name} className="flex cursor-pointer items-center gap-2">
                <Controller control={control} name={at(name)} render={({ field }) => <Checkbox checked={!!field.value} onCheckedChange={(v) => field.onChange(!!v)} />} />
                {label}
              </label>
            ))}
          </div>
        </Field>
        <Field id="eco-cnaes" label="CNAE principal" optional hint="Código ou começo do código, separados por vírgula. Ex.: 6821, 6911-7/01">
          <Input id="eco-cnaes" placeholder="6821" {...register(at("econodata.cnaesText"))} />
        </Field>
      </div>

      <Field id="eco-sizes" label="Porte" optional hint="Classificação da Econodata; sem marcar, vale qualquer porte.">
        <Controller
          control={control}
          name={at("econodata.sizes")}
          render={({ field }) => (
            <div className="flex flex-wrap gap-x-4 gap-y-2 pt-1 text-[13px]">
              {SIZES.map((s) => (
                <label key={s.id} className="flex cursor-pointer items-center gap-2">
                  <Checkbox
                    checked={(field.value as string[]).includes(s.id)}
                    onCheckedChange={(v) => field.onChange(v ? [...(field.value as string[]), s.id] : (field.value as string[]).filter((x) => x !== s.id))}
                  />
                  {s.label}
                </label>
              ))}
            </div>
          )}
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        {(
          [
            ["econodata.activeOnly", "Só empresas ativas", "situação ATIVA na Receita"],
            ["econodata.onlyWithPhone", "Só com telefone", "empresas que têm telefone na base"],
          ] as const
        ).map(([name, label, hint]) => (
          <label key={name} className="flex items-center justify-between gap-4 rounded-lg border px-3 py-2.5">
            <span>
              <span className="block text-[13px] font-medium">{label}</span>
              <span className="block text-xs text-muted-foreground">{hint}</span>
            </span>
            <Controller control={control} name={at(name)} render={({ field }) => <Switch checked={!!field.value} onCheckedChange={field.onChange} />} />
          </label>
        ))}
      </div>

      <Field id="eco-buckets" label="Dados trazidos por empresa" hint="Cada bloco tem custo próprio. Blocos não liberados ficam em Configurações › Dados empresariais.">
        <Controller
          control={control}
          name={at("econodata.buckets")}
          render={({ field }) => (
            <div className="grid gap-2 pt-1 sm:grid-cols-2">
              {SEARCH_BUCKETS.map((b) => {
                const fixed = b.id === "cadastro";
                const allowed = allowedBuckets.includes(b.id);
                const checked = (field.value as string[]).includes(b.id);
                return (
                  <label key={b.id} className={cn("flex items-start gap-2 rounded-lg border px-3 py-2 text-[13px]", !allowed && "opacity-55")}>
                    <Checkbox
                      className="mt-0.5"
                      checked={checked}
                      disabled={fixed || !allowed}
                      onCheckedChange={(v) => field.onChange(v ? [...(field.value as string[]), b.id] : (field.value as string[]).filter((x) => x !== b.id))}
                    />
                    <span>
                      <span className="block font-medium">{b.label}</span>
                      <span className="block text-xs text-muted-foreground">{allowed ? b.hint : "não liberado nesta conta"}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        />
      </Field>

      <div className="grid gap-3 rounded-lg bg-muted/50 p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-[13px] font-medium">
            <Coins className="size-4 text-muted-foreground" />
            Prévia de quantidade e custo
            {preview?.simulated && <Badge variant="outline">simulado</Badge>}
          </span>
          <Button type="button" variant="outline" size="sm" onClick={onPreview} disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : <Calculator />}
            {preview && !stale ? "Calcular de novo" : "Ver quantidade e custo"}
          </Button>
        </div>
        {!preview || stale ? (
          <p className="text-xs text-muted-foreground">{preview && stale ? "Os filtros mudaram: calcule a prévia de novo antes de buscar." : "Calcule a prévia para liberar a busca. A contagem não traz empresas."}</p>
        ) : preview.total == null ? (
          <p className="text-xs font-medium text-destructive">{preview.blocked}</p>
        ) : (
          <div className="grid gap-1 text-[13px]" aria-live="polite">
            <span>
              <strong className="num">{n(preview.total)}</strong> empresa(s) na Econodata com estes filtros · esta busca traz <strong className="num">{n(preview.willFetch)}</strong>
              {preview.willFetch < preview.total ? " (limite escolhido)" : ""}.
            </span>
            {preview.willFetch > 0 && (
              <span className="text-muted-foreground">
                Custo estimado: até <strong className="num text-foreground">{preview.tokensEstimated != null ? n(preview.tokensEstimated) : "não informado"}</strong> tokens
                {preview.pages > 1 ? ` (${preview.pages} páginas de até ${preview.tokensPerPage != null ? n(preview.tokensPerPage) : "?"})` : ""}. Empresas já trazidas nas últimas 24 h não são cobradas de novo.
              </span>
            )}
            {preview.usage && (
              <span className="text-xs text-muted-foreground">
                Hoje: {n(preview.usage.tokens)} de {n(preview.usage.maxDailyTokens)} tokens e {n(preview.usage.requests)} de {n(preview.usage.maxDailyRequests)} consultas.
              </span>
            )}
            {preview.willFetch === 0 && <span className="text-xs text-muted-foreground">Nada a buscar: revise a cidade, a palavra-chave ou os filtros.</span>}
            {preview.blocked && <span className="text-xs font-medium text-destructive">{preview.blocked}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

/** Aviso quando a Econodata não está liberada para a conta. */
export function EconodataUnavailable({ reason }: { reason: string | null }) {
  return (
    <Alert>
      <Building2 />
      <AlertTitle>Econodata indisponível nesta conta</AlertTitle>
      <AlertDescription className="text-[13px]">{reason ?? "Ative os dados empresariais em Configurações."}</AlertDescription>
    </Alert>
  );
}
