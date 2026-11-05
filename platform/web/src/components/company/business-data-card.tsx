"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Building2, Check, FlaskConical, Loader2, RefreshCw } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState, SectionCard } from "@/components/page";
import { api, errorMessage } from "@/lib/api";
import { fmtDate, fmtDateTime, fmtNumber } from "@/lib/format";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";

// ── Tipos devolvidos pela API (modules/company-data) ──
type Nature = "OFFICIAL" | "DECLARED" | "OBSERVED" | "ESTIMATED";
type DataPoint<T> = { value: T; nature: Nature; source: string; fetchedAt: string; note?: string | null };
type Range = { min: number | null; max: number | null; value: number | null };
type Profile = {
  cnpj: string;
  simulated: boolean;
  legalName?: DataPoint<string>;
  tradeName?: DataPoint<string>;
  unitType?: DataPoint<string>;
  registrationStatus?: DataPoint<string>;
  registrationStatusDate?: DataPoint<string>;
  openedAt?: DataPoint<string>;
  legalNature?: DataPoint<string>;
  primaryCnae?: DataPoint<{ code: string | null; description: string | null }>;
  secondaryCnaes?: DataPoint<{ code: string | null; description: string | null }[]>;
  address?: DataPoint<{ street: string | null; neighborhood: string | null; city: string | null; state: string | null; postalCode: string | null }>;
  taxRegime?: DataPoint<string>;
  taxSizeClass?: DataPoint<string>;
  shareCapital?: DataPoint<number>;
  size?: DataPoint<string>;
  employees?: DataPoint<Range>;
  employeesGroup?: DataPoint<Range>;
  revenue?: DataPoint<Range>;
  revenueGroup?: DataPoint<Range>;
  foreignTrade?: DataPoint<{ exportYears: string[]; importYears: string[] }>;
  group?: DataPoint<{ rootCnpj: string | null; name: string | null; states: string[] }>;
  branches?: DataPoint<{ cnpj: string }[]>;
  governmentRevenue?: DataPoint<number>;
  sectorGrowth?: DataPoint<string>;
  technologies?: DataPoint<string[]>;
  partnersCount?: DataPoint<number>;
  phones?: DataPoint<{ number: string; type: string | null; hasWhatsapp: boolean | null }[]>;
  emails?: DataPoint<string[]>;
  decisionMakers?: DataPoint<{ name: string | null; roles: string[]; departments: string[] }[]>;
};
type Candidate = { cnpj: string; legalName: string | null; tradeName: string | null; confidence: number; matchedBy: string[] };
type DataDto = {
  status: "MATCHED" | "CANDIDATES" | "NOT_FOUND" | "FAILED";
  simulated: boolean;
  cnpj: string | null;
  matchConfidence: number | null;
  matchedBy: string[];
  identifiedBy: string | null;
  profile: Profile | null;
  candidates: Candidate[];
  warnings: string[];
  tokensCharged: number;
  errorCode: string | null;
  error: string | null;
  fetchedAt: string | null;
  cached: boolean;
};
type BusinessData = { enabled: boolean; configured: boolean; simulated: boolean; companyCnpj: string | null; data: DataDto | null };
type Estimate = { enabled: boolean; simulated: boolean; path: "cnpj_known" | "match"; tokens: number | null; blocked: string | null; usage: { requests: number; tokens: number }; note: string | null };

const NATURE: Record<Nature, { label: string; tone: string }> = {
  OFFICIAL: { label: "Oficial", tone: "bg-success-soft text-success" },
  DECLARED: { label: "Declarado", tone: "bg-info-soft text-info" },
  OBSERVED: { label: "Observado", tone: "bg-muted text-muted-foreground" },
  ESTIMATED: { label: "Estimado", tone: "bg-warning-soft text-[color-mix(in_oklch,var(--warning),black_35%)] dark:text-warning" },
};
const MATCHED_BY: Record<string, string> = { cnpj: "CNPJ", site: "site", telefone: "telefone", email: "e-mail", nome: "nome", uf: "UF" };
const IDENTIFIED: Record<string, string> = { cnpj_known: "CNPJ já validado", match: "correspondência automática segura", manual_choice: "confirmada por uma pessoa" };
const SIZE: Record<string, string> = { INDIVIDUAL: "Individual", MICRO: "Micro", PEQUENO: "Pequeno", MEDIO: "Médio", GRANDE: "Grande" };

export const formatCnpj = (d: string | null | undefined) => (d && d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : (d ?? "—"));
const money = (n: number) => (n >= 1_000_000 ? `R$ ${(n / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi` : n >= 1000 ? `R$ ${(n / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} mil` : `R$ ${fmtNumber(n)}`);
function rangeText(r: Range, asMoney = false) {
  const f = asMoney ? money : (n: number) => fmtNumber(n);
  if (r.min != null && r.max != null) return `${f(r.min)} a ${f(r.max)}`;
  if (r.max != null) return `até ${f(r.max)}`;
  if (r.min != null) return `${f(r.min)} ou mais`;
  return r.value != null ? `cerca de ${f(r.value)}` : "Não disponível";
}
const yearsSince = (iso: string) => Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / (365.25 * 86_400_000)));
/** Data sem hora ("2015-01-01") vira dia/mês/ano sem passar pelo fuso (senão recua um dia no Brasil). */
const fmtDay = (v: string) => (/^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10).split("-").reverse().join("/") : fmtDate(v));

export function BusinessDataCard({ companyId }: { companyId: string }) {
  const { can } = useSession();
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const q = useQuery({ queryKey: ["business-data", companyId], queryFn: () => api<BusinessData>(`/companies/${companyId}/business-data`) });
  const estimate = useQuery({
    queryKey: ["business-data-estimate", companyId],
    queryFn: () => api<Estimate>(`/companies/${companyId}/business-data/estimate`, { method: "POST" }),
    enabled: confirm,
    staleTime: 0,
    retry: false,
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["business-data", companyId] });
    qc.invalidateQueries({ queryKey: ["intelligence", companyId] });
  };
  const enrich = useMutation({
    mutationFn: (force: boolean) => api<DataDto>(`/companies/${companyId}/business-data`, { method: "POST", body: { force } }),
    onSuccess: (d) => {
      setConfirm(false);
      refresh();
      if (d.status === "MATCHED") toast.success(d.cached ? "Dados reaproveitados do cache (sem nova cobrança)" : `Dados empresariais atualizados · ${fmtNumber(d.tokensCharged)} tokens`);
      else if (d.status === "CANDIDATES") toast.info("Identificação ambígua: confirme qual é a empresa");
      else if (d.status === "NOT_FOUND") toast.info("O fornecedor não encontrou esta empresa");
      else toast.error(d.error ?? "Não foi possível consultar agora");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const choose = useMutation({
    mutationFn: (cnpj: string) => api<DataDto>(`/companies/${companyId}/business-data/confirm`, { method: "POST", body: { cnpj } }),
    onSuccess: (d) => {
      refresh();
      if (d.status === "MATCHED") toast.success(`Empresa confirmada e enriquecida · ${fmtNumber(d.tokensCharged)} tokens`);
      else toast.error(d.error ?? "Não foi possível consultar agora");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (q.isLoading) return <Skeleton className="h-48 w-full" />;
  if (q.error || !q.data) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  const b = q.data;
  const d = b.data;
  const canRun = can("enrich:run") && b.enabled && b.configured;
  const busy = enrich.isPending || choose.isPending;

  return (
    <SectionCard
      title="Dados empresariais"
      description="Cadastro oficial e estimativas da Econodata. Cada dado mostra a natureza (oficial, declarado, observado ou estimado), a fonte e a data."
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {b.simulated && (
            <Badge variant="outline" className="gap-1">
              <FlaskConical className="size-3" /> Simulado
            </Badge>
          )}
          {canRun && (
            <Button size="sm" variant={d?.status === "MATCHED" ? "outline" : "default"} onClick={() => setConfirm(true)} disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : d?.status === "MATCHED" ? <RefreshCw /> : <Building2 />} {d?.status === "MATCHED" ? "Atualizar dados" : "Enriquecer empresa"}
            </Button>
          )}
        </div>
      }
    >
      {!b.enabled ? (
        <p className="text-sm text-muted-foreground">
          Desativado nesta conta. Um administrador pode ativar em{" "}
          <Link href="/configuracoes?tab=dados" className="underline underline-offset-2">
            Configurações › Dados empresariais
          </Link>
          .
        </p>
      ) : !b.configured ? (
        <p className="text-sm text-muted-foreground">Sem chave da Econodata nesta conta. Um administrador cadastra em Configurações › Dados empresariais.</p>
      ) : !d ? (
        <p className="text-sm text-muted-foreground">
          Ainda não consultada. {b.companyCnpj ? `CNPJ já conhecido (${formatCnpj(b.companyCnpj)}): a consulta é direta.` : "Sem CNPJ validado: primeiro a empresa é identificada pelo site, telefone ou e-mail."}
        </p>
      ) : (
        <div className="grid gap-4">
          {d.simulated && <Notice tone="warn">Dados SIMULADOS (modo de teste): não representam a empresa real.</Notice>}
          {d.warnings.map((w) => (
            <Notice key={w}>{w}</Notice>
          ))}
          {d.error && <Notice tone="warn">{d.status === "MATCHED" ? `A última atualização falhou e os dados abaixo são da consulta anterior. ${d.error}` : d.error}</Notice>}
          {d.status === "CANDIDATES" && <Candidates candidates={d.candidates} disabled={!canRun || busy} onChoose={(cnpj) => choose.mutate(cnpj)} />}
          {d.status === "NOT_FOUND" && <p className="text-sm text-muted-foreground">O fornecedor não encontrou esta empresa com os dados disponíveis.</p>}
          {d.status === "MATCHED" && d.profile && <ProfileView data={d} profile={d.profile} />}
          <p className="text-[11px] text-muted-foreground">
            {d.fetchedAt ? `Consulta de ${fmtDateTime(d.fetchedAt)}` : "Sem consulta concluída"} · {fmtNumber(d.tokensCharged)} tokens{d.cached ? " · reaproveitada do cache" : ""}
          </p>
        </div>
      )}

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{d?.status === "MATCHED" ? "Atualizar os dados empresariais?" : "Enriquecer esta empresa?"}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="grid gap-2 text-sm">
                {estimate.isLoading && (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="size-4 animate-spin" /> Calculando o custo com o fornecedor (sem cobrança)…
                  </span>
                )}
                {estimate.error && <span className="text-destructive">{errorMessage(estimate.error)}</span>}
                {estimate.data && (
                  <>
                    <span>{estimate.data.path === "cnpj_known" ? "Consulta direta pelo CNPJ já validado." : (estimate.data.note ?? "Primeiro a empresa é identificada; só depois, se a identificação for segura, vem a consulta completa.")}</span>
                    <span>
                      Custo estimado pelo fornecedor: <strong>{estimate.data.tokens != null ? `${fmtNumber(estimate.data.tokens)} tokens` : "não informado"}</strong>
                      {estimate.data.path === "match" ? " na identificação" : ""}. Hoje a conta já fez {fmtNumber(estimate.data.usage.requests)} consulta(s) e usou {fmtNumber(estimate.data.usage.tokens)} tokens.
                    </span>
                    {estimate.data.blocked && <span className="font-medium text-destructive">{estimate.data.blocked}</span>}
                    {estimate.data.simulated && <span className="text-muted-foreground">Modo simulado: nada é cobrado de verdade.</span>}
                  </>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={!estimate.data || !!estimate.data.blocked || enrich.isPending}
              onClick={(e) => {
                e.preventDefault();
                enrich.mutate(d?.status === "MATCHED");
              }}
            >
              {enrich.isPending && <Loader2 className="animate-spin" />} Consultar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SectionCard>
  );
}

function Notice({ children, tone }: { children: React.ReactNode; tone?: "warn" }) {
  return (
    <p className={cn("flex items-start gap-1.5 rounded-md px-2.5 py-1.5 text-xs", tone === "warn" ? "bg-warning-soft text-[color-mix(in_oklch,var(--warning),black_35%)] dark:text-warning" : "bg-muted text-muted-foreground")}>
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> <span>{children}</span>
    </p>
  );
}

function Candidates({ candidates, disabled, onChoose }: { candidates: Candidate[]; disabled: boolean; onChoose: (cnpj: string) => void }) {
  return (
    <div className="grid gap-2">
      <p className="text-sm">O fornecedor encontrou mais de uma possibilidade. Confirme qual é esta empresa; a consulta completa só é feita depois da sua escolha.</p>
      <ul className="divide-y rounded-lg border">
        {candidates.map((c) => (
          <li key={c.cnpj} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
            <div className="min-w-0 flex-1 text-sm">
              <div className="font-medium">{c.tradeName || c.legalName || "Sem nome"}</div>
              <div className="text-xs text-muted-foreground">
                {c.legalName ?? "Razão social não informada"} · CNPJ {formatCnpj(c.cnpj)} · confiança {Math.round(c.confidence * 100)}% · casou por {c.matchedBy.map((m) => MATCHED_BY[m] ?? m).join(", ")}
              </div>
            </div>
            <Button size="sm" variant="outline" onClick={() => onChoose(c.cnpj)} disabled={disabled}>
              <Check /> É esta
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Row<T>({ label, point, render }: { label: string; point: DataPoint<T> | undefined; render?: (v: T) => React.ReactNode }) {
  return (
    <div className="grid gap-0.5 py-1.5 sm:grid-cols-[132px_minmax(0,1fr)] sm:gap-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm">
        {point ? (
          <>
            <span className="break-words">{render ? render(point.value) : String(point.value)}</span>{" "}
            <span className={cn("ml-1 rounded px-1.5 py-0.5 align-middle text-[10px] font-medium", NATURE[point.nature].tone)} title={`${point.source} · ${fmtDateTime(point.fetchedAt)}${point.note ? ` · ${point.note}` : ""}`}>
              {NATURE[point.nature].label}
            </span>
            {point.note && <span className="block text-[11px] text-muted-foreground">{point.note}</span>}
          </>
        ) : (
          <span className="text-muted-foreground">Não disponível</span>
        )}
      </dd>
    </div>
  );
}

function ProfileView({ data: d, profile: p }: { data: DataDto; profile: Profile }) {
  const branches = p.branches?.value.length ?? 0;
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <section>
        <h3 className="mb-1 text-sm font-semibold">Dados cadastrais</h3>
        <dl className="divide-y">
          <div className="grid gap-0.5 py-1.5 sm:grid-cols-[132px_minmax(0,1fr)] sm:gap-3">
            <dt className="text-xs text-muted-foreground">CNPJ</dt>
            <dd className="text-sm">
              {formatCnpj(d.cnpj)}
              <span className="block text-[11px] text-muted-foreground">
                Identificada por: {IDENTIFIED[d.identifiedBy ?? ""] ?? "—"}
                {d.matchConfidence != null && d.identifiedBy !== "cnpj_known" ? ` · confiança ${Math.round(d.matchConfidence * 100)}% (${d.matchedBy.map((m) => MATCHED_BY[m] ?? m).join(", ")})` : ""}
              </span>
            </dd>
          </div>
          <Row label="Razão social" point={p.legalName} />
          <Row label="Nome fantasia" point={p.tradeName} />
          <Row label="Situação" point={p.registrationStatus} render={(v) => `${v}${p.registrationStatusDate ? ` desde ${fmtDay(p.registrationStatusDate.value)}` : ""}`} />
          <Row label="Abertura" point={p.openedAt} render={(v) => `${fmtDay(v)} (${yearsSince(v)} anos de atividade)`} />
          <Row label="Natureza jurídica" point={p.legalNature} />
          <Row label="Unidade" point={p.unitType} render={(v) => (v === "MATRIZ" ? "Matriz" : v === "FILIAL" ? "Filial" : v)} />
          <Row label="Endereço" point={p.address} render={(a) => [a.street, a.neighborhood, a.city && `${a.city}${a.state ? `/${a.state}` : ""}`, a.postalCode].filter(Boolean).join(" · ") || "Não disponível"} />
        </dl>
      </section>
      <section>
        <h3 className="mb-1 text-sm font-semibold">Porte e setor</h3>
        <dl className="divide-y">
          <Row label="CNAE principal" point={p.primaryCnae} render={(c) => `${c.code ?? ""} ${c.description ?? ""}`.trim()} />
          <Row label="CNAEs secundários" point={p.secondaryCnaes} render={(l) => `${l.length}: ${l.slice(0, 3).map((c) => c.description ?? c.code).join("; ")}${l.length > 3 ? "…" : ""}`} />
          <Row label="Porte" point={p.size} render={(v) => SIZE[v] ?? v} />
          <Row label="Enquadramento" point={p.taxSizeClass} />
          <Row label="Regime tributário" point={p.taxRegime} />
          <Row label="Capital social" point={p.shareCapital} render={(v) => money(v)} />
          <Row label="Sócios" point={p.partnersCount} render={(v) => `${v} no quadro societário`} />
        </dl>
      </section>
      <section className="lg:col-span-2">
        <h3 className="mb-1 text-sm font-semibold">Inteligência comercial</h3>
        <dl className="grid divide-y lg:grid-cols-2 lg:gap-x-6 lg:divide-y-0">
          <Row label="Funcionários" point={p.employees} render={(r) => rangeText(r)} />
          <Row label="Faturamento anual" point={p.revenue} render={(r) => rangeText(r, true)} />
          <Row label="Funcionários do grupo" point={p.employeesGroup} render={(r) => rangeText(r)} />
          <Row label="Faturamento do grupo" point={p.revenueGroup} render={(r) => rangeText(r, true)} />
          <Row
            label="Comércio exterior"
            point={p.foreignTrade}
            render={(f) => [f.exportYears.length ? `exportação em ${f.exportYears.join(", ")}` : null, f.importYears.length ? `importação em ${f.importYears.join(", ")}` : null].filter(Boolean).join("; ") || "sem registros"}
          />
          <Row label="Grupo econômico" point={p.group} render={(g) => [g.name, g.rootCnpj && `raiz ${g.rootCnpj}`, g.states.length ? `UFs: ${g.states.join(", ")}` : null].filter(Boolean).join(" · ")} />
          <Row label="Unidades (matriz e filiais)" point={branches ? p.branches : undefined} render={() => `${branches} unidade(s)`} />
          <Row label="Recebimentos de órgãos públicos" point={p.governmentRevenue} render={(v) => money(v)} />
          <Row label="Tendência do setor" point={p.sectorGrowth} />
          <Row label="Tecnologias" point={p.technologies} render={(t) => t.join(", ")} />
        </dl>
      </section>
      {(p.phones || p.emails || p.decisionMakers) && (
        <section className="lg:col-span-2">
          <h3 className="mb-1 text-sm font-semibold">Contatos e decisores</h3>
          <p className="mb-1 text-[11px] text-muted-foreground">Dados pessoais e de contato (LGPD): use só para uma abordagem comercial legítima e respeite pedidos de exclusão.</p>
          <dl className="divide-y">
            <Row label="Telefones" point={p.phones} render={(l) => l.map((t) => `${t.number}${t.hasWhatsapp ? " (WhatsApp segundo o fornecedor)" : ""}`).join(" · ")} />
            <Row label="E-mails" point={p.emails} render={(l) => l.join(" · ")} />
            <Row label="Decisores" point={p.decisionMakers} render={(l) => l.map((x) => `${x.name}${x.roles.length ? ` (${x.roles.join(", ")})` : ""}`).join(" · ")} />
          </dl>
        </section>
      )}
    </div>
  );
}
