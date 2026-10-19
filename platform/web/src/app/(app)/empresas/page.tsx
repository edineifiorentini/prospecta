"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef, RowSelectionState, SortingState } from "@tanstack/react-table";
import { toast } from "sonner";
import { Archive, Building2, Download, Search as SearchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader, EmptyState, ErrorState } from "@/components/page";
import { DataTable, selectionColumn } from "@/components/data-table";
import { StatusBadge } from "@/components/status-badge";
import { ScorePill } from "@/components/score-pill";
import { CompanyNameCell, ContactCell, EnrichmentBadge, RatingCell } from "@/components/companies/company-cells";
import { AddToListDialog } from "@/components/companies/add-to-list-dialog";
import { BulkCompanyActions } from "@/components/companies/bulk-actions";
import { CompanyFiltersSheet, DEFAULT_FILTERS, type CompanyFilters } from "@/components/companies/company-filters";
import { NewCompanyDialog } from "@/components/companies/new-company-dialog";
import { api, downloadUrl, errorMessage } from "@/lib/api";
import { fmtRelative } from "@/lib/format";
import { useSession } from "@/lib/session";
import type { Page } from "@/lib/types";

type CompanyRow = {
  id: string;
  name: string;
  category: string | null;
  website: string | null;
  primaryPhone: string | null;
  primaryEmail: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  rating: number | null;
  reviewCount: number | null;
  enrichmentStatus: string;
  status: string;
  createdAt: string;
  owner: { id: string; name: string } | null;
  tags: { tag: { id: string; name: string; color: string } }[];
  scores: { kind: string; score: number | null; confidence: number }[];
  deals: { id: string; stage: { name: string } }[];
};

const SORT_MAP: Record<string, string> = { empresa: "name", avaliacao: "rating", criada: "createdAt" };

export default function CompaniesPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { can } = useSession();
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [filters, setFilters] = useState<CompanyFilters>(DEFAULT_FILTERS);
  const [sorting, setSorting] = useState<SortingState>([{ id: "criada", desc: true }]);
  const [selection, setSelection] = useState<RowSelectionState>({});

  const query = useMemo(() => {
    const s = sorting[0];
    return { page, pageSize: 25, q: q || undefined, ...filters, sort: s ? (SORT_MAP[s.id] ?? "createdAt") : "createdAt", dir: s?.desc === false ? "asc" : "desc" };
  }, [page, q, filters, sorting]);

  const list = useQuery({ queryKey: ["companies", query], queryFn: () => api<Page<CompanyRow>>("/companies", { query }), placeholderData: (p) => p });

  const archive = useMutation({
    mutationFn: (ids: string[]) => api<{ updated: number }>("/companies/bulk-archive", { method: "POST", body: { companyIds: ids, archived: filters.status !== "ARCHIVED" } }),
    onSuccess: (r) => {
      toast.success(`${r.updated} empresa(s) ${filters.status === "ARCHIVED" ? "reativada(s)" : "arquivada(s)"}`);
      setSelection({});
      qc.invalidateQueries({ queryKey: ["companies"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const columns = useMemo<ColumnDef<CompanyRow, unknown>[]>(
    () => [
      selectionColumn<CompanyRow>(),
      { id: "empresa", header: "Empresa", enableHiding: false, enableSorting: true, cell: ({ row }) => <CompanyNameCell c={row.original} /> },
      { id: "contato", header: "Contato", enableSorting: false, cell: ({ row }) => <ContactCell c={row.original} /> },
      { id: "avaliacao", header: "Avaliação pública", enableSorting: true, cell: ({ row }) => <RatingCell rating={row.original.rating} reviews={row.original.reviewCount} /> },
      {
        id: "indicadores",
        header: "Dados · Oportunidade",
        enableSorting: false,
        cell: ({ row }) => {
          const s = (k: string) => row.original.scores.find((x) => x.kind === k);
          return (
            <div className="flex gap-1.5">
              <ScorePill score={s("DATA_QUALITY")?.score} confidence={s("DATA_QUALITY")?.confidence} label="Qualidade dos dados" />
              <ScorePill score={s("OPPORTUNITY")?.score} confidence={s("OPPORTUNITY")?.confidence} label="Oportunidade comercial" />
            </div>
          );
        },
      },
      { id: "enriquecimento", header: "Enriquecimento", enableSorting: false, cell: ({ row }) => <EnrichmentBadge status={row.original.enrichmentStatus} /> },
      {
        id: "crm",
        header: "CRM",
        enableSorting: false,
        cell: ({ row }) => (row.original.deals[0] ? <StatusBadge tone="progress">{row.original.deals[0].stage.name}</StatusBadge> : <span className="text-xs text-muted-foreground">—</span>),
      },
      {
        id: "etiquetas",
        header: "Etiquetas",
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex max-w-40 flex-wrap gap-1">
            {row.original.tags.map((t) => (
              <span key={t.tag.id} className="rounded-md bg-muted px-1.5 py-0.5 text-[11px]">
                {t.tag.name}
              </span>
            ))}
          </div>
        ),
      },
      { id: "criada", header: "Adicionada", enableSorting: true, cell: ({ row }) => <span className="text-xs whitespace-nowrap text-muted-foreground">{fmtRelative(row.original.createdAt)}</span> },
    ],
    [],
  );

  const ids = Object.keys(selection);
  const exportQuery = { ...query, page: undefined, pageSize: undefined };

  return (
    <>
      <PageHeader
        title="Empresas"
        description="Base de leads deduplicada, com origem e grau de confiança de cada informação."
        actions={
          <>
            {can("export:run") && (
              <Button variant="outline" size="sm" asChild>
                <a href={downloadUrl("/companies/export.csv", exportQuery)}>
                  <Download /> Exportar CSV
                </a>
              </Button>
            )}
            {can("companies:write") && <NewCompanyDialog />}
          </>
        }
      />
      {list.isError ? (
        <ErrorState message={errorMessage(list.error)} onRetry={() => list.refetch()} />
      ) : (
        <DataTable
          columns={columns}
          data={list.data?.items ?? []}
          loading={list.isFetching}
          getRowId={(r) => r.id}
          page={page}
          pageCount={list.data?.pageCount}
          total={list.data?.total}
          onPageChange={setPage}
          sorting={sorting}
          onSortingChange={(s) => {
            setSorting(s);
            setPage(1);
          }}
          selection={selection}
          onSelectionChange={setSelection}
          onRowClick={(r) => router.push(`/empresas/${r.id}`)}
          initialHidden={{ etiquetas: true }}
          empty={
            <EmptyState
              icon={Building2}
              title={q || ids.length ? "Nada encontrado" : "Nenhuma empresa com esses filtros"}
              description="Faça uma busca em Encontrar Empresas, importe um CSV ou cadastre manualmente."
              className="border-0 bg-transparent"
            />
          }
          toolbar={
            <>
              <div className="relative w-64">
                <SearchIcon className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={q}
                  onChange={(e) => {
                    setQ(e.target.value);
                    setPage(1);
                  }}
                  placeholder="Nome, domínio, telefone, e-mail…"
                  className="h-8 pl-8"
                  aria-label="Busca rápida de empresas"
                />
              </div>
              <CompanyFiltersSheet
                value={filters}
                onChange={(f) => {
                  setFilters(f);
                  setPage(1);
                }}
              />
              {ids.length > 0 && (
                <div className="ml-auto flex flex-wrap items-center gap-2">
                  <AddToListDialog companyIds={ids} onDone={() => setSelection({})} />
                  {can("companies:write") && (
                    <Button variant="outline" size="sm" onClick={() => archive.mutate(ids)} disabled={archive.isPending}>
                      <Archive /> {filters.status === "ARCHIVED" ? "Reativar" : "Arquivar"}
                    </Button>
                  )}
                  <BulkCompanyActions companyIds={ids} onDone={() => setSelection({})} />
                </div>
              )}
            </>
          }
        />
      )}
    </>
  );
}
