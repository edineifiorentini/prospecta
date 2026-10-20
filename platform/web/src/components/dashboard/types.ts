export type Grain = "day" | "week" | "month";
type Series = { bucket: string; count: number }[];
type Distribution = { buckets: { label: string; count: number }[]; notEvaluated: number };

/** Resposta de GET /api/dashboard (ver api/src/modules/reports/metrics.ts). */
export type DashboardData = {
  period: { from: string; to: string; grain: Grain; timezone: string };
  filters: { city: string | null; category: string | null };
  leads: {
    total: number;
    newInPeriod: number;
    qualified: number;
    withoutWebsite: number;
    withoutContact: number;
    incompleteData: number;
    highOpportunity: number;
    enrichment: Record<string, number>;
  };
  pipeline: {
    name: string | null;
    openDeals: number;
    openValueCents: number;
    dealsCreated: number;
    wonInPeriod: number;
    wonValueCents: number;
    lostInPeriod: number;
    winRate: number | null;
    stages: { id: string; name: string; color: string; kind: "OPEN" | "WON" | "LOST"; count: number; valueCents: number }[];
  };
  activity: {
    contacts: { calls: number; meetings: number; emails: number; whatsappSent: number; total: number };
    whatsappReceived: number;
    tasks: { open: number; overdue: number; dueToday: number; doneInPeriod: number };
    searches: { count: number; newCompanies: number; results: number };
    auditsCompleted: number;
    recent: { id: string; type: string; title: string; occurredAt: string; company: { id: string; name: string } | null; user: { name: string } | null }[];
  };
  segments: { byCity: { label: string; count: number }[]; byCategory: { label: string; count: number }[] };
  scores: Record<"DATA_QUALITY" | "GOOGLE_PRESENCE" | "WEBSITE_QUALITY" | "MULTICHANNEL" | "OPPORTUNITY", Distribution>;
  series: { newCompanies: Series; contacts: Series };
};
