import { BadgeCheck, CircleDashed, CircleHelp, CircleSlash, Sparkle, XCircle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DATA_STATUS_LABEL, SOURCE_LABEL } from "@/lib/labels";
import { fmtDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  VERIFIED: BadgeCheck,
  FOUND: CircleDashed,
  ESTIMATED: Sparkle,
  UNAVAILABLE: CircleSlash,
  INVALID: XCircle,
};
const COLOR: Record<string, string> = {
  VERIFIED: "text-success",
  FOUND: "text-info",
  ESTIMATED: "text-warning",
  UNAVAILABLE: "text-muted-foreground",
  INVALID: "text-destructive",
};

/** Indicador compacto da situação de um dado, com origem, data e confiança no tooltip. */
export function DataStatusIcon({ status, source, sourceUrl, observedAt, confidence, note, className }: { status?: string; source?: string; sourceUrl?: string | null; observedAt?: string | null; confidence?: number; note?: string; className?: string }) {
  const Icon = (status && ICON[status]) || CircleHelp;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn("inline-flex shrink-0 items-center", status ? COLOR[status] : "text-muted-foreground/60", className)} aria-label={status ? DATA_STATUS_LABEL[status] : "Origem desconhecida"}>
          <Icon className="size-3.5" />
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-72">
        <div className="font-medium">{status ? DATA_STATUS_LABEL[status] : "Sem registro de origem"}</div>
        {source && <div>Fonte: {SOURCE_LABEL[source] ?? source}</div>}
        {observedAt && <div>Em: {fmtDateTime(observedAt)}</div>}
        {confidence !== undefined && <div>Confiança: {Math.round(confidence * 100)}%</div>}
        {note && <div className="mt-1 opacity-80">{note}</div>}
        {sourceUrl && <div className="mt-1 truncate opacity-70">{sourceUrl}</div>}
      </TooltipContent>
    </Tooltip>
  );
}

export function DataStatusLegend() {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
      {Object.keys(ICON).map((s) => (
        <span key={s} className="inline-flex items-center gap-1">
          <DataStatusIcon status={s} /> {DATA_STATUS_LABEL[s]}
        </span>
      ))}
    </div>
  );
}
