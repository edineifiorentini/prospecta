"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronRight, FileSpreadsheet, Globe2, MapPin, RotateCcw, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState } from "@/components/page";
import { Skeleton } from "@/components/ui/skeleton";
import { api, errorMessage } from "@/lib/api";
import { fmtRelative } from "@/lib/format";
import { ACTIVE_STATUSES, type Page, type SearchJob } from "@/lib/types";
import { useSession } from "@/lib/session";
import { JobProgress, JobStatusBadge } from "./job-progress";

const ICONS = { OSM_OVERPASS: Globe2, GOOGLE_MAPS_SCRAPER: MapPin, CSV_IMPORT: FileSpreadsheet } as const;

export function JobList() {
  const qc = useQueryClient();
  const { can } = useSession();
  const q = useQuery({
    queryKey: ["searches"],
    queryFn: () => api<Page<SearchJob>>("/searches", { query: { pageSize: 15 } }),
    refetchInterval: (query) => (query.state.data?.items.some((j) => ACTIVE_STATUSES.includes(j.status)) ? 2500 : 15_000),
  });
  const cancel = useMutation({
    mutationFn: (id: string) => api(`/searches/${id}/cancel`, { method: "POST" }),
    onSuccess: () => {
      toast.message("Cancelamento solicitado");
      qc.invalidateQueries({ queryKey: ["searches"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const retry = useMutation({
    mutationFn: (id: string) => api<{ id: string }>(`/searches/${id}/retry`, { method: "POST" }),
    onSuccess: () => {
      toast.success("Busca reenfileirada");
      qc.invalidateQueries({ queryKey: ["searches"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (q.isLoading)
    return (
      <div className="grid gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
    );
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  if (!q.data?.items.length) return <EmptyState title="Nenhuma busca ainda" description="Sua primeira busca aparecerá aqui com o andamento em tempo real." />;

  return (
    <ul className="grid gap-3">
      {q.data.items.map((job) => {
        const Icon = ICONS[job.provider] ?? Globe2;
        const active = ACTIVE_STATUSES.includes(job.status);
        return (
          <li key={job.id} className="card-soft group p-4 transition-shadow hover:shadow-[var(--shadow-float)]">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <Icon className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/buscar/${job.id}`} className="truncate text-sm font-medium hover:underline">
                    {job.name}
                  </Link>
                  <JobStatusBadge status={job.status} />
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {fmtRelative(job.createdAt)}
                  {job.createdBy ? ` · ${job.createdBy}` : ""}
                  {job.status === "COMPLETED" && ` · ${job.newCount} novas, ${job.duplicateCount} já existentes`}
                </div>
                {(active || job.status === "FAILED") && (
                  <div className="mt-3">
                    <JobProgress job={job} compact />
                  </div>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {active && can("search:run") && (
                  <Button variant="ghost" size="sm" onClick={() => cancel.mutate(job.id)} disabled={cancel.isPending}>
                    <Square /> Cancelar
                  </Button>
                )}
                {(job.status === "FAILED" || job.status === "CANCELLED") && job.provider !== "CSV_IMPORT" && can("search:run") && (
                  <Button variant="ghost" size="sm" onClick={() => retry.mutate(job.id)} disabled={retry.isPending}>
                    <RotateCcw /> Repetir
                  </Button>
                )}
                <Button variant="ghost" size="icon-sm" asChild aria-label="Ver resultados">
                  <Link href={`/buscar/${job.id}`}>
                    <ChevronRight />
                  </Link>
                </Button>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
