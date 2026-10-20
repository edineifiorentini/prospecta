"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef, RowSelectionState } from "@tanstack/react-table";
import { ArrowLeft, Download, Filter, Search as SearchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PageHeader, SectionCard, ErrorState } from "@/components/page";
import { DataTable, selectionColumn } from "@/components/data-table";
import { TriStateFilter, type Tri } from "@/components/tri-state";
import { StatusBadge } from "@/components/status-badge";
import { JobProgress, JobStatusBadge } from "@/components/search/job-progress";
import { AddToListDialog } from "@/components/companies/add-to-list-dialog";
import { BulkCompanyActions } from "@/components/companies/bulk-actions";
import { CompanyNameCell, ContactCell, EnrichmentBadge, RatingCell } from "@/components/companies/company-cells";
import { SearchResultsMap } from "@/components/map/search-results-map";
import { api, downloadUrl, errorMessage } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { SOURCE_LABEL } from "@/lib/labels";
import { useSession } from "@/lib/session";
import { ACTIVE_STATUSES, type Page, type SearchJob, type SearchResultRow } from "@/lib/types";

const MATCH_LABEL: Record<string, string> = {
  google_place_id: "mesmo place_id",
  google_cid: "mesmo CID",
  osm_id: "mesmo ID OSM",
  domain: "mesmo domínio",
  phone: "mesmo telefone",
  name_address: "mesmo nome e endereço",
  filtered_out: "fora dos filtros",
};

export default function SearchResultsPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useSession();
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [filters, setFilters] = useState<{ website: Tri; phone: Tri; email: Tri; minRating?: number }>({ website: "any", phone: "any", email: "any" });
  const [selection, setSelection] = useState<RowSelectionState>({});

  const job = useQuery({
    queryKey: ["search", id],
    queryFn: () => api<SearchJob>(`/searches/${id}`),
    refetchInterval: (query) => (query.state.data && ACTIVE_STATUSES.includes(query.state.data.status) ? 2000 : false),
  });
  const active = job.data ? ACTIVE_STATUSES.includes(job.data.status) : false;
  const results = useQuery({
    queryKey: ["search-results", id, page, q, filters],
    queryFn: () => api<Page<SearchResultRow> & { filteredOut: number }>(`/searches/${id}/results`, { query: { page, pageSize: 25, q: q || undefined, ...filters } }),
    refetchInterval: active ? 4000 : false,
    placeholderData: (prev) => prev,
  });

  const columns = useMemo<ColumnDef<SearchResultRow, unknown>[]>(
    () => [
      selectionColumn<SearchResultRow>(),
      { id: "pos", header: "#", size: 40, cell: ({ row }) => <span className="num text-xs text-muted-foreground">{row.original.position}</span> },
      {
        id: "name",
        header: "Empresa",
        enableHiding: false,
        cell: ({ row }) => (row.original.company ? <CompanyNameCell c={row.original.company} /> : <span className="text-sm text-muted-foreground">{row.original.title}</span>),
      },
      { id: "contato", header: "Contato", cell: ({ row }) => (row.original.company ? <ContactCell c={row.original.company} /> : null) },
      { id: "avaliacao", header: "Avaliação pública", cell: ({ row }) => (row.original.company ? <RatingCell rating={row.original.company.rating} reviews={row.original.company.reviewCount} /> : null) },
      { id: "enriquecimento", header: "Enriquecimento", cell: ({ row }) => (row.original.company ? <EnrichmentBadge status={row.original.company.enrichmentStatus} /> : null) },
      {
        id: "situacao",
        header: "Situação",
        cell: ({ row }) =>
          row.original.isNew ? (
            <StatusBadge tone="success">Nova</StatusBadge>
          ) : (
            <StatusBadge tone={row.original.matchedBy === "filtered_out" ? "neutral" : "info"}>{MATCH_LABEL[row.original.matchedBy ?? ""] ?? "Já existia"}</StatusBadge>
          ),
      },
    ],
    [],
  );

  if (job.isError) return <ErrorState message={errorMessage(job.error)} onRetry={() => job.refetch()} />;
  const j = job.data;
  const selectedIds = [...new Set(Object.keys(selection).map((k) => k.split(":")[0]!).filter((id) => id !== "x"))];
  const params = (j?.params ?? {}) as Record<string, unknown>;
  const activeFilters = [filters.website, filters.phone, filters.email].filter((v) => v !== "any").length + (filters.minRating ? 1 : 0);

  return (
    <>
      <Button variant="ghost" size="sm" asChild className="-ml-2 mb-2 text-muted-foreground">
        <Link href="/buscar">
          <ArrowLeft /> Encontrar Empresas
        </Link>
      </Button>
      <PageHeader
        title={j?.name ?? "Carregando…"}
        description={j ? `${SOURCE_LABEL[j.provider]} · criada em ${fmtDateTime(j.createdAt)}${j.createdBy ? ` por ${j.createdBy}` : ""}` : undefined}
        actions={
          j && (
            <>
              <JobStatusBadge status={j.status} />
              {can("export:run") && j.status === "COMPLETED" && (
                <Button variant="outline" size="sm" asChild>
                  <a href={downloadUrl(`/searches/${id}/export.csv`)}>
                    <Download /> Exportar CSV
                  </a>
                </Button>
              )}
            </>
          )
        }
      />
      {j && (
        <SectionCard className="mb-6" title="Andamento" description={params.city ? `Área: ${[params.neighborhood, params.city, params.state].filter(Boolean).join(", ")} · raio ${params.radiusKm} km · até ${params.limit} empresas` : undefined}>
          <JobProgress job={j} />
          {j.provider === "OSM_OVERPASS" && <p className="mt-3 text-[11px] text-muted-foreground">Dados © colaboradores do OpenStreetMap, disponíveis sob a licença ODbL.</p>}
          {j.provider === "GOOGLE_MAPS_SCRAPER" && (
            <p className="mt-3 text-[11px] text-muted-foreground">Coletado com o motor gosom/google-maps-scraper (MIT). Trate como leads a verificar; não redistribua dados do Google.</p>
          )}
        </SectionCard>
      )}
      {j && <SearchResultsMap searchId={id} active={active} />}

      <DataTable
        columns={columns}
        data={results.data?.items ?? []}
        loading={results.isFetching && !results.data}
        // um resultado por linha: dois pontos da fonte podem ter sido unificados na mesma empresa
        getRowId={(r) => `${r.companyId ?? "x"}:${r.id}`}
        canSelect={(r) => !!r.companyId}
        selection={selection}
        onSelectionChange={setSelection}
        page={page}
        pageCount={results.data?.pageCount}
        total={results.data?.total}
        onPageChange={setPage}
        empty={active ? "Os resultados aparecerão aqui conforme forem gravados." : "Nenhum resultado com esses filtros."}
        toolbar={
          <>
            <div className="relative w-56">
              <SearchIcon className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setPage(1);
                }}
                placeholder="Filtrar por nome"
                className="h-8 pl-8"
              />
            </div>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm">
                  <Filter /> Filtros {activeFilters > 0 && <span className="rounded-full bg-primary px-1.5 text-[10px] text-primary-foreground">{activeFilters}</span>}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="grid w-80 gap-3">
                {(["website", "phone", "email"] as const).map((k) => (
                  <TriStateFilter
                    key={k}
                    id={`rf-${k}`}
                    label={{ website: "Site", phone: "Telefone", email: "E-mail" }[k]}
                    value={filters[k]}
                    onChange={(v) => {
                      setFilters((f) => ({ ...f, [k]: v }));
                      setPage(1);
                    }}
                  />
                ))}
                <label className="flex items-center justify-between gap-3 text-[13px]">
                  Nota mínima
                  <Input
                    type="number"
                    min={0}
                    max={5}
                    step={0.5}
                    className="h-8 w-20"
                    value={filters.minRating ?? ""}
                    onChange={(e) => setFilters((f) => ({ ...f, minRating: e.target.value ? Number(e.target.value) : undefined }))}
                  />
                </label>
              </PopoverContent>
            </Popover>
            {results.data && results.data.filteredOut > 0 && <span className="text-xs text-muted-foreground">{results.data.filteredOut} resultado(s) fora dos filtros da busca (não salvos)</span>}
            {selectedIds.length > 0 && (
              <div className="ml-auto flex items-center gap-2">
                <AddToListDialog companyIds={selectedIds} onDone={() => setSelection({})} />
                <BulkCompanyActions companyIds={selectedIds} onDone={() => setSelection({})} />
              </div>
            )}
          </>
        }
      />
    </>
  );
}
