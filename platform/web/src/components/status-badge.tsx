import { cn } from "@/lib/utils";

export type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "progress";

const TONES: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-[color-mix(in_oklch,var(--warning),black_25%)] dark:text-warning",
  danger: "bg-danger-soft text-destructive",
  info: "bg-info-soft text-info",
  progress: "bg-accent text-accent-foreground",
};

export function StatusBadge({ tone = "neutral", children, className, dot = true, pulse }: { tone?: Tone; children: React.ReactNode; className?: string; dot?: boolean; pulse?: boolean }) {
  return (
    <span className={cn("inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium whitespace-nowrap", TONES[tone], className)}>
      {dot && <span className={cn("size-1.5 rounded-full bg-current", pulse && "animate-pulse")} aria-hidden />}
      {children}
    </span>
  );
}

export const jobTone = (status: string): Tone =>
  status === "COMPLETED" ? "success" : status === "FAILED" ? "danger" : status === "CANCELLED" ? "neutral" : status === "QUEUED" ? "info" : "progress";

export const dataTone = (status: string): Tone =>
  status === "VERIFIED" ? "success" : status === "FOUND" ? "info" : status === "ESTIMATED" ? "warning" : status === "INVALID" ? "danger" : "neutral";
