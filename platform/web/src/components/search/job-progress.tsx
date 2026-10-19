"use client";

import { Progress } from "@/components/ui/progress";
import { StatusBadge, jobTone } from "@/components/status-badge";
import { JOB_STATUS_LABEL, SOURCE_LABEL } from "@/lib/labels";
import { fmtDuration } from "@/lib/format";
import { ACTIVE_STATUSES, type SearchJob } from "@/lib/types";

export function JobStatusBadge({ status }: { status: SearchJob["status"] }) {
  return (
    <StatusBadge tone={jobTone(status)} pulse={ACTIVE_STATUSES.includes(status)}>
      {JOB_STATUS_LABEL[status] ?? status}
    </StatusBadge>
  );
}

/** Andamento real informado pelo worker (fase, mensagem, contadores e tempo decorrido). */
export function JobProgress({ job, compact }: { job: SearchJob; compact?: boolean }) {
  const p = job.progress ?? {};
  const active = ACTIVE_STATUSES.includes(job.status);
  const percent = job.status === "COMPLETED" ? 100 : (p.percent ?? (active ? undefined : 0));
  return (
    <div className="grid gap-2">
      {active && (
        <Progress value={percent ?? 8} className={percent === undefined ? "animate-pulse" : undefined} aria-label="Andamento da busca" />
      )}
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {job.status === "FAILED" ? <span className="text-destructive">{job.error ?? p.message}</span> : p.message}
      </p>
      {!compact && (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-4">
          <Stat label="Encontradas" value={p.found ?? job.resultCount} />
          <Stat label="Novas" value={p.imported ?? job.newCount} />
          <Stat label="Já existentes" value={p.duplicates ?? job.duplicateCount} />
          <Stat label="Fora dos filtros" value={p.filteredOut ?? 0} />
          {p.elapsedSec != null && active && <Stat label="Tempo decorrido" value={`${fmtDuration(p.elapsedSec)}${p.maxTimeSec ? ` / ${fmtDuration(p.maxTimeSec)}` : ""}`} />}
          <Stat label="Fonte" value={SOURCE_LABEL[job.provider] ?? job.provider} />
        </dl>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-dashed py-1 sm:block sm:border-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="num font-medium text-foreground">{value ?? "—"}</dd>
    </div>
  );
}
