"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Building2, ClipboardList, FileSearch, FileSpreadsheet, FileText, Handshake, Loader2, MessageCircle, Search, Sigma, SquareActivity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ErrorState, PageHeader, SectionCard } from "@/components/page";
import { FiltersBar } from "@/components/dashboard/filters-bar";
import { useExport } from "@/components/dashboard/export-menu";
import { api, errorMessage } from "@/lib/api";
import { useDashboardFilters } from "@/lib/period";
import { useSession } from "@/lib/session";

type SummaryRow = { group: string; label: string; value: string; definition: string };

function ReportCard({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card-soft flex flex-col gap-4 p-5">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-primary">
          <Icon className="size-4" />
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="mt-auto flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

function ReportsInner() {
  const { can } = useSession();
  const { query } = useDashboardFilters();
  const { busy, run } = useExport();
  const [dealStatus, setDealStatus] = useState("ALL");
  const allowed = can("export:run");
  const summary = useQuery({ queryKey: ["report-summary", query], queryFn: () => api<{ rows: SummaryRow[] }>("/reports/summary", { query }), placeholderData: (p) => p });
  const groups = [...new Set(summary.data?.rows.map((r) => r.group) ?? [])];
  const scope = { city: query.city, category: query.category };

  const btn = (path: string, label: string, q: Record<string, unknown>, pdf = false) => (
    <Button variant={pdf ? "default" : "outline"} size="sm" disabled={!allowed || !!busy} onClick={() => run(path, q)}>
      {busy === path ? <Loader2 className="animate-spin" /> : pdf ? <FileText /> : <FileSpreadsheet />} {label}
    </Button>
  );

  return (
    <>
      <PageHeader
        title="Relatórios"
        description="Exporte os dados da operação com o período e os filtros selecionados. Os arquivos são gerados na hora, a partir dos registros da plataforma."
      />
      <div className="mb-5">
        <FiltersBar />
      </div>
      {!allowed && <p className="mb-4 rounded-lg border bg-muted/50 px-4 py-3 text-sm text-muted-foreground">Seu perfil pode consultar os indicadores, mas não exportar arquivos. Peça a um gestor ou administrador.</p>}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <ReportCard icon={Sigma} title="Resumo de indicadores" description="Leads, funil, contatos, tarefas, segmentos e distribuição das pontuações, cada um com a forma de cálculo.">
          {btn("/reports/summary.pdf", "PDF", query, true)}
          {btn("/reports/summary.csv", "CSV", query)}
        </ReportCard>
        <ReportCard icon={Building2} title="Empresas" description="Base completa com contatos, status de verificação, redes, pontuações e etapa no CRM (cidade e segmento do filtro).">
          {btn("/companies/export.csv", "CSV", { ...scope, status: "ACTIVE" })}
          <Button variant="ghost" size="sm" asChild>
            <Link href="/empresas">
              Filtrar antes <ArrowUpRight />
            </Link>
          </Button>
        </ReportCard>
        <ReportCard icon={Handshake} title="Negociações" description="Todas as negociações com etapa, valor estimado, responsável e datas de fechamento.">
          <Select value={dealStatus} onValueChange={setDealStatus}>
            <SelectTrigger size="sm" className="w-32 text-xs" aria-label="Situação das negociações">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Todas</SelectItem>
              <SelectItem value="OPEN">Abertas</SelectItem>
              <SelectItem value="WON">Ganhas</SelectItem>
              <SelectItem value="LOST">Perdidas</SelectItem>
            </SelectContent>
          </Select>
          {btn("/reports/deals.csv", "CSV", { ...scope, status: dealStatus === "ALL" ? undefined : dealStatus })}
        </ReportCard>
        <ReportCard icon={SquareActivity} title="Atividades" description="Ligações, reuniões, e-mails, anotações, mudanças de etapa e demais registros do período.">
          {btn("/reports/activities.csv", "CSV", query)}
        </ReportCard>
        <ReportCard icon={ClipboardList} title="Tarefas" description="Tarefas abertas e as criadas ou concluídas no período, com prazo, prioridade e responsável.">
          {btn("/reports/tasks.csv", "CSV", query)}
        </ReportCard>
        <ReportCard icon={MessageCircle} title="Mensagens do WhatsApp" description="Histórico enviado e recebido no período, com situação de entrega e quem enviou.">
          {btn("/reports/messages.csv", "CSV", query)}
        </ReportCard>
        <ReportCard icon={FileSearch} title="Auditorias digitais" description="Relatório em PDF por empresa, com evidências, pontuações e recomendações.">
          <Button variant="outline" size="sm" asChild>
            <Link href="/auditorias">
              Abrir auditorias <ArrowUpRight />
            </Link>
          </Button>
        </ReportCard>
        <ReportCard icon={Search} title="Resultados de buscas" description="CSV de cada busca com os dados coletados e a fonte de cada empresa.">
          <Button variant="outline" size="sm" asChild>
            <Link href="/buscar">
              Abrir buscas <ArrowUpRight />
            </Link>
          </Button>
        </ReportCard>
      </div>

      <SectionCard className="mt-6" title="Indicadores do período" description="Mesmos números do resumo exportado, com a regra de cálculo de cada um." bodyClassName="p-0">
        {summary.isError ? (
          <div className="p-5">
            <ErrorState message={errorMessage(summary.error)} onRetry={() => summary.refetch()} />
          </div>
        ) : !summary.data ? (
          <div className="grid gap-2 p-5">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-8" />
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <tbody>
                {groups.map((g) => (
                  <GroupRows key={g} group={g} rows={summary.data!.rows.filter((r) => r.group === g)} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </>
  );
}

function GroupRows({ group, rows }: { group: string; rows: SummaryRow[] }) {
  return (
    <>
      <tr className="bg-muted/40">
        <th colSpan={3} className="px-5 py-2 text-left text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          {group}
        </th>
      </tr>
      {rows.map((r) => (
        <tr key={`${group}-${r.label}`} className="border-t">
          <td className="px-5 py-2">{r.label}</td>
          <td className="num px-5 py-2 text-right font-medium whitespace-nowrap">{r.value}</td>
          <td className="hidden px-5 py-2 text-xs text-muted-foreground md:table-cell">{r.definition}</td>
        </tr>
      ))}
    </>
  );
}

export default function ReportsPage() {
  return (
    <Suspense>
      <ReportsInner />
    </Suspense>
  );
}
