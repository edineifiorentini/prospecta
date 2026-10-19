"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef, RowSelectionState } from "@tanstack/react-table";
import { toast } from "sonner";
import { ArrowLeft, Download, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader, ErrorState } from "@/components/page";
import { DataTable, selectionColumn } from "@/components/data-table";
import { CompanyNameCell, ContactCell, EnrichmentBadge, RatingCell } from "@/components/companies/company-cells";
import { BulkCompanyActions } from "@/components/companies/bulk-actions";
import { api, downloadUrl, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { CompanySummary } from "@/lib/types";

type ListDetail = { id: string; name: string; description: string | null; items: (CompanySummary & { addedAt: string })[] };

export default function ListPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { can } = useSession();
  const [selection, setSelection] = useState<RowSelectionState>({});
  const q = useQuery({ queryKey: ["list", id], queryFn: () => api<ListDetail>(`/lists/${id}`) });
  const removeItem = useMutation({
    mutationFn: (companyId: string) => api(`/lists/${id}/items/${companyId}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["list", id] }),
  });
  const removeList = useMutation({
    mutationFn: () => api(`/lists/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Lista excluída (as empresas continuam cadastradas)");
      qc.invalidateQueries({ queryKey: ["lists"] });
      router.replace("/listas");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const columns = useMemo<ColumnDef<ListDetail["items"][number], unknown>[]>(
    () => [
      selectionColumn(),
      { id: "empresa", header: "Empresa", enableHiding: false, cell: ({ row }) => <CompanyNameCell c={row.original} /> },
      { id: "contato", header: "Contato", cell: ({ row }) => <ContactCell c={row.original} /> },
      { id: "avaliacao", header: "Avaliação pública", cell: ({ row }) => <RatingCell rating={row.original.rating} reviews={row.original.reviewCount} /> },
      { id: "enriquecimento", header: "Enriquecimento", cell: ({ row }) => <EnrichmentBadge status={row.original.enrichmentStatus} /> },
      {
        id: "remover",
        header: "",
        enableHiding: false,
        size: 40,
        cell: ({ row }) =>
          can("companies:write") && (
            <Button variant="ghost" size="icon-sm" aria-label="Remover da lista" onClick={(e) => (e.stopPropagation(), removeItem.mutate(row.original.id))}>
              <X />
            </Button>
          ),
      },
    ],
    [can, removeItem],
  );

  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  const ids = Object.keys(selection);
  return (
    <>
      <Button variant="ghost" size="sm" asChild className="-ml-2 mb-2 text-muted-foreground">
        <Link href="/listas">
          <ArrowLeft /> Minhas Listas
        </Link>
      </Button>
      <PageHeader
        title={q.data?.name ?? "Carregando…"}
        description={q.data?.description ?? `${q.data?.items.length ?? 0} empresa(s)`}
        actions={
          <>
            {can("export:run") && (
              <Button variant="outline" size="sm" asChild>
                <a href={downloadUrl("/companies/export.csv", { listId: id, status: "ALL" })}>
                  <Download /> Exportar CSV
                </a>
              </Button>
            )}
            {can("companies:write") && (
              <Button variant="ghost" size="sm" onClick={() => removeList.mutate()}>
                <Trash2 /> Excluir lista
              </Button>
            )}
          </>
        }
      />
      <DataTable
        columns={columns}
        data={q.data?.items ?? []}
        loading={q.isLoading}
        getRowId={(r) => r.id}
        selection={selection}
        onSelectionChange={setSelection}
        onRowClick={(r) => router.push(`/empresas/${r.id}`)}
        toolbar={ids.length > 0 && <BulkCompanyActions companyIds={ids} onDone={() => setSelection({})} />}
      />
    </>
  );
}
