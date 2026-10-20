"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Line, ComposedChart, XAxis, YAxis } from "recharts";
import {
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  Building2,
  CheckCircle2,
  Globe,
  Handshake,
  ListTodo,
  MessageCircle,
  PhoneOff,
  Search,
  Sparkles,
  Target,
  TrendingUp,
  UserCheck,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { EmptyState, ErrorState, PageHeader, SectionCard } from "@/components/page";
import { FiltersBar } from "@/components/dashboard/filters-bar";
import { ExportMenu } from "@/components/dashboard/export-menu";
import type { DashboardData } from "@/components/dashboard/types";
import { api, errorMessage } from "@/lib/api";
import { fmtMoney, fmtNumber, fmtRelative } from "@/lib/format";
import { ACTIVITY_LABEL, SCORE_LABEL, STAGE_DOT } from "@/lib/labels";
import { bucketLabel, fillSeries, useDashboardFilters } from "@/lib/period";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";

const pct = (v: number | null) => (v == null ? "—" : `${Math.round(v * 100)}%`);

function Kpi({ icon: Icon, label, value, hint, href, tone = "neutral", help }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; hint?: React.ReactNode; href?: string; tone?: "neutral" | "warning"; help: string }) {
  const body = (
    <div className={cn("card-soft group flex h-full flex-col gap-3 p-4 transition-colors", href && "hover:border-primary/40")}>
      <div className="flex items-center justify-between gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="cursor-help text-xs font-medium text-muted-foreground underline decoration-dotted decoration-muted-foreground/40 underline-offset-4">{label}</span>
          </TooltipTrigger>
          <TooltipContent className="max-w-60">{help}</TooltipContent>
        </Tooltip>
        <span className={cn("flex size-7 items-center justify-center rounded-lg", tone === "warning" ? "bg-warning-soft text-warning" : "bg-accent text-primary")}>
          <Icon className="size-3.5" />
        </span>
      </div>
      <div className="num text-2xl font-semibold tracking-tight">{value}</div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
  return href ? (
    <Link href={href} className="block rounded-xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
      {body}
    </Link>
  ) : (
    body
  );
}

function RankBars({ rows, hrefFor }: { rows: { label: string; count: number }[]; hrefFor: (label: string) => string }) {
  if (!rows.length) return <p className="py-6 text-center text-sm text-muted-foreground">Sem dados no filtro atual.</p>;
  const max = Math.max(...rows.map((r) => r.count), 1);
  return (
    <ul className="grid gap-2.5">
      {rows.map((r) => (
        <li key={r.label}>
          <Link href={hrefFor(r.label)} className="group grid gap-1 rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="truncate group-hover:text-primary">{r.label}</span>
              <span className="num text-xs text-muted-foreground">{fmtNumber(r.count)}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary/70" style={{ width: `${(r.count / max) * 100}%` }} />
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

const trendConfig = { newCompanies: { label: "Novos leads", color: "var(--chart-1)" }, contacts: { label: "Contatos", color: "var(--info)" } } satisfies ChartConfig;
const scoreConfig = { count: { label: "Empresas", color: "var(--chart-1)" } } satisfies ChartConfig;

function DashboardSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4" aria-busy aria-label="Carregando indicadores">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-32 rounded-xl" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Skeleton className="h-80 rounded-xl lg:col-span-2" />
        <Skeleton className="h-80 rounded-xl" />
      </div>
    </div>
  );
}

function DashboardInner() {
  const { session } = useSession();
  const { query, filters } = useDashboardFilters();
  const [scoreKind, setScoreKind] = useState<keyof DashboardData["scores"]>("OPPORTUNITY");
  const m = useQuery({ queryKey: ["dashboard", query], queryFn: () => api<DashboardData>("/dashboard", { query }), placeholderData: (p) => p, refetchInterval: 60_000 });
  const scopeQs = new URLSearchParams({ ...(filters.city ? { city: filters.city } : {}), ...(filters.category ? { category: filters.category } : {}) }).toString();
  const companies = (extra: Record<string, string>) => `/empresas?${new URLSearchParams({ ...Object.fromEntries(new URLSearchParams(scopeQs)), ...extra }).toString()}`;

  const header = (
    <PageHeader
      title={`Olá, ${session?.user.name.split(" ")[0] ?? ""}`}
      description="Indicadores calculados a partir dos registros da plataforma. Passe o mouse sobre cada título para ver como ele é calculado."
      actions={<ExportMenu query={query} />}
    />
  );

  if (m.isError && !m.data)
    return (
      <>
        {header}
        <ErrorState message={errorMessage(m.error)} onRetry={() => m.refetch()} />
      </>
    );

  const d = m.data;
  const trend = d ? fillSeries(d.period.from, d.period.to, d.period.grain, { newCompanies: d.series.newCompanies, contacts: d.series.contacts }).map((r) => ({ ...r, label: bucketLabel(String(r.bucket), d.period.grain) })) : [];
  const openStages = d?.pipeline.stages ?? [];
  const maxStage = Math.max(...openStages.map((s) => s.count), 1);
  const dist = d?.scores[scoreKind];

  return (
    <>
      {header}
      <div className="mb-5">
        <FiltersBar />
      </div>
      {!d ? (
        <DashboardSkeleton />
      ) : d.leads.total === 0 && !filters.city && !filters.category ? (
        <EmptyState
          icon={Search}
          title="Nenhuma empresa ainda"
          description="Os indicadores aparecem assim que você salvar as primeiras empresas de uma busca, importação ou cadastro manual."
          action={
            <Button asChild>
              <Link href="/buscar">Fazer a primeira busca</Link>
            </Button>
          }
        />
      ) : (
        <div className={cn("grid grid-cols-1 gap-4 transition-opacity", m.isFetching && "opacity-80")}>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
            <Kpi icon={Building2} label="Novos leads" value={fmtNumber(d.leads.newInPeriod)} hint={`de ${fmtNumber(d.leads.total)} empresas ativas`} href={companies({})} help="Empresas cadastradas no período por busca, importação ou cadastro manual." />
            <Kpi icon={UserCheck} label="Leads qualificados" value={fmtNumber(d.leads.qualified)} hint="no funil, após a 1ª etapa" href="/crm" help="Situação atual: empresas com negociação aberta ou ganha que já saíram da primeira etapa do funil." />
            <Kpi icon={MessageCircle} label="Contatos realizados" value={fmtNumber(d.activity.contacts.total)} hint={`${d.activity.contacts.calls} ligações · ${d.activity.contacts.whatsappSent} WhatsApp`} help="Ligações, reuniões e e-mails registrados no período, mais mensagens de WhatsApp com envio confirmado." />
            <Kpi icon={Handshake} label="Negociações abertas" value={fmtNumber(d.pipeline.openDeals)} hint={`${fmtMoney(d.pipeline.openValueCents)} em aberto`} href="/crm" help="Situação atual. O valor soma apenas os valores estimados informados nas negociações." />
            <Kpi icon={TrendingUp} label="Conversão" value={pct(d.pipeline.winRate)} hint={`${d.pipeline.wonInPeriod} ganhas · ${d.pipeline.lostInPeriod} perdidas`} help="Negociações ganhas ÷ (ganhas + perdidas) fechadas no período. Sem fechamentos, fica em branco." />
            <Kpi
              icon={ListTodo}
              label="Tarefas pendentes"
              value={fmtNumber(d.activity.tasks.open)}
              tone={d.activity.tasks.overdue ? "warning" : "neutral"}
              hint={d.activity.tasks.overdue ? <span className="text-warning">{d.activity.tasks.overdue} atrasada(s)</span> : `${d.activity.tasks.dueToday} para hoje`}
              href="/tarefas"
              help="Situação atual das tarefas abertas; atrasadas têm prazo vencido."
            />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <SectionCard className="lg:col-span-2" title="Evolução no período" description={`Agrupado por ${d.period.grain === "day" ? "dia" : d.period.grain === "week" ? "semana" : "mês"}`}>
              {trend.every((r) => !(r as Record<string, unknown>).newCompanies && !(r as Record<string, unknown>).contacts) ? (
                <p className="py-20 text-center text-sm text-muted-foreground">Nenhum lead novo ou contato registrado no período.</p>
              ) : (
                <ChartContainer config={trendConfig} className="aspect-auto h-64 w-full">
                  <ComposedChart data={trend} margin={{ left: 0, right: 8, top: 8 }}>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={16} fontSize={11} />
                    <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={32} fontSize={11} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <ChartLegend content={<ChartLegendContent />} />
                    <Bar dataKey="newCompanies" fill="var(--color-newCompanies)" radius={[4, 4, 0, 0]} maxBarSize={28} />
                    <Line dataKey="contacts" type="monotone" stroke="var(--color-contacts)" strokeWidth={2} dot={false} />
                  </ComposedChart>
                </ChartContainer>
              )}
            </SectionCard>
            <SectionCard
              title="Funil"
              description={d.pipeline.name ?? "Sem funil configurado"}
              actions={
                <Button variant="ghost" size="sm" asChild>
                  <Link href="/crm">
                    Abrir <ArrowUpRight />
                  </Link>
                </Button>
              }
            >
              <ul className="grid gap-2">
                {openStages.map((s) => (
                  <li key={s.id} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1">
                    <span className="flex min-w-0 items-center gap-2 text-sm">
                      <span className={cn("size-2 shrink-0 rounded-full", STAGE_DOT[s.color] ?? "bg-slate-400")} />
                      <span className="truncate">{s.name}</span>
                    </span>
                    <span className="num text-xs text-muted-foreground">
                      {s.count}
                      {s.valueCents ? ` · ${fmtMoney(s.valueCents)}` : ""}
                    </span>
                    <div className="col-span-2 h-1 overflow-hidden rounded-full bg-muted">
                      <div className={cn("h-full rounded-full", s.kind === "LOST" ? "bg-destructive/50" : "bg-primary/70")} style={{ width: `${(s.count / maxStage) * 100}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            </SectionCard>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Kpi icon={Globe} label="Sem site" value={fmtNumber(d.leads.withoutWebsite)} hint="ver empresas" href={companies({ website: "without" })} help="Empresas ativas sem site informado ou encontrado. Costumam ser oportunidade para presença digital." />
            <Kpi icon={PhoneOff} label="Sem nenhum contato" value={fmtNumber(d.leads.withoutContact)} hint="ver empresas" href={companies({ phone: "without", email: "without" })} help="Sem telefone nem e-mail válido registrado." />
            <Kpi icon={AlertTriangle} label="Dados incompletos" value={fmtNumber(d.leads.incompleteData)} hint="qualidade dos dados abaixo de 60" href={companies({ maxDataQuality: "59" })} help="Pontuação de qualidade dos dados abaixo de 60, conforme a metodologia (endereço, contatos, site, redes, categoria…)." />
            <Kpi icon={Target} label="Alta oportunidade" value={fmtNumber(d.leads.highOpportunity)} hint="oportunidade comercial ≥ 60" href={companies({ minOpportunity: "60" })} help="Empresas auditadas com lacunas comprovadas por evidência. Só conta quem já passou por auditoria." />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <SectionCard title="Por cidade" description="Empresas ativas">
              <RankBars rows={d.segments.byCity} hrefFor={(city) => companies({ city })} />
            </SectionCard>
            <SectionCard title="Por segmento" description="Empresas ativas">
              <RankBars rows={d.segments.byCategory} hrefFor={(category) => companies({ category })} />
            </SectionCard>
            <SectionCard title="Distribuição das pontuações" description={dist ? `${fmtNumber(dist.notEvaluated)} não avaliada(s) — sem evidência suficiente` : undefined}>
              <Select value={scoreKind} onValueChange={(v) => setScoreKind(v as typeof scoreKind)}>
                <SelectTrigger size="sm" className="mb-3 w-full text-xs" aria-label="Dimensão da pontuação">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(SCORE_LABEL) as (keyof DashboardData["scores"])[]).map((k) => (
                    <SelectItem key={k} value={k}>
                      {SCORE_LABEL[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {dist && dist.buckets.some((b) => b.count) ? (
                <ChartContainer config={scoreConfig} className="aspect-auto h-44 w-full">
                  <BarChart data={dist.buckets} margin={{ left: 0, right: 4, top: 4 }}>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} />
                    <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={28} fontSize={11} />
                    <ChartTooltip content={<ChartTooltipContent hideIndicator />} />
                    <Bar dataKey="count" fill={scoreKind === "OPPORTUNITY" ? "var(--info)" : "var(--color-count)"} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ChartContainer>
              ) : (
                <p className="py-12 text-center text-sm text-muted-foreground">Nenhuma empresa pontuada nesta dimensão ainda.</p>
              )}
            </SectionCard>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <SectionCard className="lg:col-span-2" title="Atividades recentes">
              {d.activity.recent.length ? (
                <ul className="divide-y">
                  {d.activity.recent.map((a) => (
                    <li key={a.id} className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                      <div className="min-w-0">
                        <div className="truncate text-sm">
                          <span className="font-medium">{a.title}</span>
                          {a.company && (
                            <>
                              {" · "}
                              <Link href={`/empresas/${a.company.id}`} className="text-muted-foreground hover:text-primary">
                                {a.company.name}
                              </Link>
                            </>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {ACTIVITY_LABEL[a.type] ?? a.type}
                          {a.user ? ` · ${a.user.name}` : ""}
                        </div>
                      </div>
                      <span className="shrink-0 text-xs text-muted-foreground">{fmtRelative(a.occurredAt)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="py-8 text-center text-sm text-muted-foreground">Nenhuma atividade registrada.</p>
              )}
            </SectionCard>
            <div className="grid grid-cols-1 gap-4">
              <SectionCard title="Operação no período">
                <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground">Buscas</dt>
                    <dd className="num font-medium">{fmtNumber(d.activity.searches.count)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Empresas novas</dt>
                    <dd className="num font-medium">{fmtNumber(d.activity.searches.newCompanies)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Auditorias</dt>
                    <dd className="num font-medium">{fmtNumber(d.activity.auditsCompleted)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Tarefas concluídas</dt>
                    <dd className="num font-medium">{fmtNumber(d.activity.tasks.doneInPeriod)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Negociações criadas</dt>
                    <dd className="num font-medium">{fmtNumber(d.pipeline.dealsCreated)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Valor ganho</dt>
                    <dd className="num font-medium">{fmtMoney(d.pipeline.wonValueCents)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">WhatsApp recebidas</dt>
                    <dd className="num font-medium">{fmtNumber(d.activity.whatsappReceived)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Enriquecidas</dt>
                    <dd className="num font-medium">{fmtNumber((d.leads.enrichment.DONE ?? 0) + (d.leads.enrichment.PARTIAL ?? 0))}</dd>
                  </div>
                </dl>
              </SectionCard>
              <ServicesCard />
            </div>
          </div>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Sparkles className="size-3" /> Pontuações seguem a metodologia interna e não são avaliações oficiais do Google.{" "}
            <Link href="/relatorios" className="inline-flex items-center gap-1 underline-offset-4 hover:text-foreground hover:underline">
              <BarChart3 className="size-3" /> Relatórios e exportações
            </Link>
          </p>
        </div>
      )}
    </>
  );
}

type Probe = { ok: boolean; ms: number; error?: string };
type Status = { db: Probe; queue: Probe; scraper: Probe; wuzapi: Probe; googleMapsEnabled: boolean };
const SERVICES: Record<keyof Omit<Status, "googleMapsEnabled">, string> = { db: "Banco de dados", queue: "Filas", scraper: "Motor Google Maps", wuzapi: "WhatsApp (WuzAPI)" };

function ServicesCard() {
  const { data } = useQuery({ queryKey: ["system-status"], queryFn: () => api<Status>("/system/status"), refetchInterval: 30_000 });
  return (
    <SectionCard title="Serviços" description="Verificados agora">
      <ul className="grid gap-2">
        {(Object.keys(SERVICES) as (keyof typeof SERVICES)[]).map((k) => {
          const p = data?.[k];
          return (
            <li key={k} className="flex items-center justify-between gap-2 text-sm">
              <span className="flex items-center gap-2">
                {p?.ok ? <CheckCircle2 className="size-4 text-primary" /> : <XCircle className="size-4 text-muted-foreground" />}
                {SERVICES[k]}
              </span>
              <span className="text-xs text-muted-foreground">{!p ? "…" : p.ok ? `${p.ms} ms` : "indisponível"}</span>
            </li>
          );
        })}
      </ul>
    </SectionCard>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <DashboardInner />
    </Suspense>
  );
}
