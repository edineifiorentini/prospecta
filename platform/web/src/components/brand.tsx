import { Radar } from "lucide-react";
import { cn } from "@/lib/utils";

export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-gradient-to-br from-emerald-500 to-green-600 text-white shadow-[0_1px_2px_rgb(0_0_0/0.12),inset_0_1px_0_rgb(255_255_255/0.25)]",
        className,
      )}
      aria-hidden
    >
      <Radar className="size-[18px]" strokeWidth={2.2} />
    </span>
  );
}

export function Brand({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <BrandMark />
      {!compact && (
        <span className="flex flex-col leading-none">
          <span className="text-[15px] font-semibold tracking-tight">Prospecta</span>
          <span className="mt-0.5 text-[11px] text-muted-foreground">Prospecção & CRM</span>
        </span>
      )}
    </span>
  );
}
