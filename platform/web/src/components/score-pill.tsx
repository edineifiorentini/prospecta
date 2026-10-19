import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** Pontuação 0–100 com cor por faixa; null = "Não avaliado". */
export function ScorePill({ score, confidence, label, className }: { score: number | null | undefined; confidence?: number; label?: string; className?: string }) {
  // em Oportunidade comercial, valor alto é bom para vendas: usa escala neutra (azul), não vermelho/verde
  const opportunity = label === "Oportunidade comercial";
  const tone =
    score == null
      ? "bg-muted text-muted-foreground"
      : opportunity
        ? score >= 60
          ? "bg-info text-white"
          : "bg-info-soft text-info"
        : score >= 70
        ? "bg-success-soft text-success"
        : score >= 40
          ? "bg-warning-soft text-[color-mix(in_oklch,var(--warning),black_30%)] dark:text-warning"
          : "bg-danger-soft text-destructive";
  const pill = (
    <span className={cn("inline-flex h-6 min-w-10 items-center justify-center rounded-md px-1.5 text-xs font-semibold num", tone, className)}>{score == null ? "N/A" : score}</span>
  );
  if (!label && confidence === undefined) return pill;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{pill}</TooltipTrigger>
      <TooltipContent>
        {label && <div className="font-medium">{label}</div>}
        {score == null ? "Não avaliado (dados insuficientes)" : `Confiança: ${Math.round((confidence ?? 0) * 100)}% dos critérios avaliados`}
      </TooltipContent>
    </Tooltip>
  );
}
