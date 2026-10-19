"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState, PageHeader } from "@/components/page";
import { ReportBody, type AuditDetail } from "@/components/audit/report-view";
import { api, downloadUrl, errorMessage } from "@/lib/api";

export default function AuditReportPage() {
  const { id } = useParams<{ id: string }>();
  const q = useQuery({ queryKey: ["audit", id], queryFn: () => api<AuditDetail>(`/audits/${id}`), refetchInterval: (query) => (["QUEUED", "RUNNING"].includes(query.state.data?.status ?? "") ? 3000 : false) });
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  if (!q.data) return <Skeleton className="h-[600px]" />;
  const a = q.data;
  return (
    <>
      <Button variant="ghost" size="sm" asChild className="-ml-2 mb-2 text-muted-foreground">
        <Link href="/auditorias">
          <ArrowLeft /> Auditorias
        </Link>
      </Button>
      <PageHeader
        title={
          <Link href={`/empresas/${a.company.id}`} className="hover:underline">
            {a.company.name}
          </Link>
        }
        description={`Relatório de presença digital · ${[a.company.category, [a.company.city, a.company.state].filter(Boolean).join("/")].filter(Boolean).join(" · ")}`}
        actions={
          a.status === "COMPLETED" && (
            <Button asChild>
              <a href={downloadUrl(`/audits/${a.id}/report.pdf`)}>
                <Download /> Exportar PDF
              </a>
            </Button>
          )
        }
      />
      {a.status === "COMPLETED" ? <ReportBody audit={a} /> : a.status === "FAILED" ? <ErrorState message={a.error ?? "A auditoria falhou."} /> : <p className="text-sm text-muted-foreground">Auditoria em andamento…</p>}
    </>
  );
}
