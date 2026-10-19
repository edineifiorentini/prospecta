import Link from "next/link";
import { ExternalLink, Globe, Mail, Phone, Star } from "lucide-react";
import { fmtNumber, fmtPhone, fmtRating, hostOf } from "@/lib/format";
import { ENRICHMENT_LABEL } from "@/lib/labels";
import { StatusBadge, type Tone } from "@/components/status-badge";
import type { CompanySummary } from "@/lib/types";

export function CompanyNameCell({ c }: { c: Pick<CompanySummary, "id" | "name" | "category"> & { city?: string | null; neighborhood?: string | null } }) {
  return (
    <div className="min-w-48">
      <Link href={`/empresas/${c.id}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
        {c.name}
      </Link>
      <div className="truncate text-xs text-muted-foreground">{[c.category, c.neighborhood, c.city].filter(Boolean).join(" · ") || "—"}</div>
    </div>
  );
}

export function ContactCell({ c }: { c: Pick<CompanySummary, "primaryPhone" | "primaryEmail" | "website"> }) {
  return (
    <div className="grid gap-0.5 text-xs">
      <span className={`flex items-center gap-1.5 ${c.primaryPhone ? "" : "text-muted-foreground/60"}`}>
        <Phone className="size-3" /> {c.primaryPhone ? fmtPhone(c.primaryPhone) : "sem telefone"}
      </span>
      <span className={`flex items-center gap-1.5 truncate ${c.primaryEmail ? "" : "text-muted-foreground/60"}`}>
        <Mail className="size-3" /> {c.primaryEmail ?? "sem e-mail"}
      </span>
      {c.website ? (
        <a href={c.website} target="_blank" rel="noopener noreferrer nofollow" className="flex items-center gap-1.5 truncate text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
          <Globe className="size-3" /> {hostOf(c.website)}
          <ExternalLink className="size-2.5" />
        </a>
      ) : (
        <span className="flex items-center gap-1.5 text-muted-foreground/60">
          <Globe className="size-3" /> sem site
        </span>
      )}
    </div>
  );
}

export function RatingCell({ rating, reviews }: { rating: number | null; reviews: number | null }) {
  if (rating == null) return <span className="text-xs text-muted-foreground">não disponível</span>;
  return (
    <span className="inline-flex items-center gap-1 text-sm">
      <Star className="size-3.5 fill-amber-400 text-amber-400" />
      <span className="num font-medium">{fmtRating(rating)}</span>
      <span className="num text-xs text-muted-foreground">({fmtNumber(reviews)})</span>
    </span>
  );
}

const ENRICH_TONE: Record<string, Tone> = { DONE: "success", PARTIAL: "warning", FAILED: "danger", RUNNING: "progress", QUEUED: "info", SKIPPED: "neutral", NOT_STARTED: "neutral" };

export function EnrichmentBadge({ status }: { status: string }) {
  return (
    <StatusBadge tone={ENRICH_TONE[status] ?? "neutral"} pulse={status === "RUNNING" || status === "QUEUED"}>
      {ENRICHMENT_LABEL[status] ?? status}
    </StatusBadge>
  );
}
