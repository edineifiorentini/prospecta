"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { FileSearch, Search as SearchIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DataTable } from "@/components/data-table";
import { EmptyState, PageHeader } from "@/components/page";
import { ScorePill } from "@/components/score-pill";
import { StatusBadge, jobTone } from "@/components/status-badge";
import { api } from "@/lib/api";
import { fmtRelative } from "@/lib/format";
import { JOB_STATUS_LABEL, SCORE_LABEL } from "@/lib/labels";
import type { Page } from "@/lib/types";

type Row = { id: string; status: string; scores: Record<string, { score: number | null; confidence: number }>; createdAt: string; finishedAt: string | null; company: { id: string; name: string; category: string | null; city: string | null }; services: { name: string }[] };

export default function AuditsPage() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [minOpp, setMinOpp] = useState("any");
  const list = useQuery({
    queryKey: ["audits", page, q, minOpp],
    queryFn: () => api<Page<Row>>("/audits", { query: { page, q: q || undefined, minOpportunity: minOpp === "any" ? undefined : minOpp } }),
    placeholderData: (p) => p,
    refetchInterval: (query) => (query.state.data?.items.some((a) => a.status === "QUEUED" || a.status === "RUNNING") ? 4000 : false),
  });
  const columns = useMemo<ColumnDef<Row, unknown>[]>(
    () => [
      {
        id: "empresa",
        header: "Empresa",
        cell: ({ row }) => (
          <div>
            <div className="font-medium">{row.original.company.name}</div>
            <div className="text-xs text-muted-foreground">{[row.original.company.category, row.original.company.city].filter(Boolean).join(" · ")}</div>
          </div>
        ),
      },
      ...["OPPORTUNITY", "WEBSITE_QUALITY", "MULTICHANNEL", "GOOGLE_PRESENCE", "DATA_QUALITY"].map(
        (k): ColumnDef<Row, unknown> => ({ id: k, header: SCORE_LABEL[k], cell: ({ row }) => <ScorePill score={row.original.scores?.[k]?.score ?? null} confidence={row.original.scores?.[k]?.confidence} label={SCORE_LABEL[k]} /> }),
      ),
      { id: "servicos", header: "Serviços sugeridos", cell: ({ row }) => <span className="line-clamp-2 max-w-64 text-xs text-muted-foreground">{row.original.services?.map((s) => s.name).join(", ") || "—"}</span> },
      {
        id: "status",
        header: "Situação",
        cell: ({ row }) => (
          <div className="grid gap-0.5">
            <StatusBadge tone={jobTone(row.original.status)}>{JOB_STATUS_LABEL[row.original.status] ?? row.original.status}</StatusBadge>
            <span className="text-[11px] text-muted-foreground">{fmtRelative(row.original.finishedAt ?? row.original.createdAt)}</span>
          </div>
        ),
      },
    ],
    [],
  );
  return (
    <>
      <PageHeader title="Auditorias" description="Diagnósticos de presença digital baseados em evidências públicas, com pontuações e oportunidades comerciais." />
      <DataTable
        columns={columns}
        data={list.data?.items ?? []}
        loading={list.isFetching}
        getRowId={(r) => r.id}
        page={page}
        pageCount={list.data?.pageCount}
        total={list.data?.total}
        onPageChange={setPage}
        onRowClick={(r) => router.push(r.status === "COMPLETED" ? `/auditorias/${r.id}` : `/empresas/${r.company.id}?tab=auditoria`)}
        empty={<EmptyState icon={FileSearch} title="Nenhuma auditoria" description="Abra a ficha de uma empresa e clique em “Auditoria digital”." className="border-0 bg-transparent" />}
        toolbar={
          <>
            <div className="relative w-64">
              <SearchIcon className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input value={q} onChange={(e) => (setQ(e.target.value), setPage(1))} placeholder="Buscar empresa" className="h-8 pl-8" aria-label="Buscar empresa" />
            </div>
            <Select value={minOpp} onValueChange={(v) => (setMinOpp(v), setPage(1))}>
              <SelectTrigger className="h-8 w-56" aria-label="Oportunidade mínima">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Qualquer oportunidade</SelectItem>
                <SelectItem value="35">Oportunidade ≥ 35 (moderada)</SelectItem>
                <SelectItem value="60">Oportunidade ≥ 60 (alta)</SelectItem>
              </SelectContent>
            </Select>
          </>
        }
      />
    </>
  );
}
