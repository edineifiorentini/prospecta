"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, FileSearch, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { EmptyState, ErrorState } from "@/components/page";
import { Skeleton } from "@/components/ui/skeleton";
import { api, downloadUrl, errorMessage } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { useSession } from "@/lib/session";
import { ReportBody, type AuditDetail } from "./report-view";

type AuditRow = { id: string; status: string; scores: AuditDetail["scores"]; createdAt: string; finishedAt: string | null; error: string | null };

export function CompanyAuditPanel({ companyId }: { companyId: string }) {
  const qc = useQueryClient();
  const { can } = useSession();
  const list = useQuery({
    queryKey: ["company-audits", companyId],
    queryFn: () => api<AuditRow[]>(`/companies/${companyId}/audits`),
    refetchInterval: (q) => (q.state.data?.some((a) => a.status === "QUEUED" || a.status === "RUNNING") ? 3000 : false),
  });
  const latestDone = list.data?.find((a) => a.status === "COMPLETED");
  const running = list.data?.find((a) => a.status === "QUEUED" || a.status === "RUNNING");
  const detail = useQuery({ queryKey: ["audit", latestDone?.id], queryFn: () => api<AuditDetail>(`/audits/${latestDone!.id}`), enabled: !!latestDone });
  const start = useMutation({
    mutationFn: () => api(`/companies/${companyId}/audit`, { method: "POST" }),
    onSuccess: () => {
      toast.success("Auditoria iniciada");
      qc.invalidateQueries({ queryKey: ["company-audits", companyId] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (list.isLoading) return <Skeleton className="h-64" />;
  if (list.isError) return <ErrorState message={errorMessage(list.error)} onRetry={() => list.refetch()} />;

  return (
    <div className="grid gap-4">
      {running && (
        <div className="card-soft grid gap-2 p-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Loader2 className="size-4 animate-spin text-primary" /> Auditoria em andamento
          </div>
          <Progress value={running.status === "QUEUED" ? 10 : 55} className="animate-pulse" />
          <p className="text-xs text-muted-foreground">Analisando site (respeitando robots.txt), Lighthouse, links, redes e dados públicos. Leva de 30 s a 2 min.</p>
        </div>
      )}
      {!latestDone && !running ? (
        <EmptyState
          icon={FileSearch}
          title="Nenhuma auditoria ainda"
          description="A auditoria avalia dados do lead, presença pública no Google, site, redes sociais e oportunidade comercial — só com evidências."
          action={
            can("audit:run") && (
              <Button onClick={() => start.mutate()} disabled={start.isPending}>
                {start.isPending ? <Loader2 className="animate-spin" /> : <FileSearch />} Gerar auditoria
              </Button>
            )
          }
        />
      ) : (
        latestDone && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">Última auditoria: {fmtDateTime(latestDone.finishedAt)}</p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/auditorias/${latestDone.id}`}>Relatório completo</Link>
                </Button>
                <Button variant="outline" size="sm" asChild>
                  <a href={downloadUrl(`/audits/${latestDone.id}/report.pdf`)}>
                    <Download /> PDF
                  </a>
                </Button>
                {can("audit:run") && (
                  <Button size="sm" onClick={() => start.mutate()} disabled={!!running || start.isPending}>
                    Refazer
                  </Button>
                )}
              </div>
            </div>
            {detail.data ? <ReportBody audit={detail.data} compact /> : <Skeleton className="h-96" />}
          </>
        )
      )}
      {list.data?.some((a) => a.status === "FAILED") && !running && (
        <p className="text-xs text-destructive">Uma auditoria anterior falhou: {list.data.find((a) => a.status === "FAILED")?.error}</p>
      )}
    </div>
  );
}
