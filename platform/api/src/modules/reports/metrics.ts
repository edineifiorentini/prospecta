import { z } from "zod";
import { Prisma, prisma } from "../../lib/prisma.ts";

/** Fuso usado para agrupar séries por dia/semana. */
export const TZ = "America/Sao_Paulo";
const DAY = 86_400_000;

export const metricsQuery = z.object({
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  city: z.string().trim().max(120).optional(),
  category: z.string().trim().max(160).optional(),
});
export type MetricsQuery = z.infer<typeof metricsQuery>;

/** Fim do dia corrente em São Paulo (sem horário de verão desde 2019: UTC−3). */
export function endOfDay(d: Date) {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
  return new Date(`${ymd}T23:59:59.999-03:00`);
}

export function resolvePeriod(q: Pick<MetricsQuery, "from" | "to">) {
  const to = q.to ? new Date(q.to) : new Date();
  const from = q.from ? new Date(q.from) : new Date(to.getTime() - 30 * DAY);
  if (from > to) return { from: to, to: from };
  return { from, to };
}

const CONTACT_ACTIVITY = ["CALL", "MEETING", "EMAIL"] as const;
const SENT_STATUSES = ["SENT", "DELIVERED", "READ"] as const;
const BUCKETS = ["0–19", "20–39", "40–59", "60–79", "80–100"];
const SCORE_KINDS = ["DATA_QUALITY", "GOOGLE_PRESENCE", "WEBSITE_QUALITY", "MULTICHANNEL", "OPPORTUNITY"] as const;

/**
 * Métricas do painel. Tudo é calculado a partir dos registros do banco — nenhum valor é estimado.
 * "Período" filtra fluxos (novos leads, contatos, ganhos); "situação atual" mostra o estoque no momento da consulta.
 */
export async function dashboardMetrics(organizationId: string, q: MetricsQuery) {
  const { from, to } = resolvePeriod(q);
  const company: Prisma.CompanyWhereInput = { organizationId, status: "ACTIVE", ...(q.city ? { city: q.city } : {}), ...(q.category ? { category: q.category } : {}) };
  const scoped = !!(q.city || q.category);
  const viaCompany = scoped ? { company } : {};
  const sqlScope = Prisma.sql`c.organization_id = ${organizationId}::uuid AND c.status = 'ACTIVE'
    ${q.city ? Prisma.sql`AND c.city = ${q.city}` : Prisma.empty}
    ${q.category ? Prisma.sql`AND c.category = ${q.category}` : Prisma.empty}`;
  const period = { gte: from, lte: to };
  const now = new Date();
  const endOfToday = endOfDay(now);
  const spanDays = (to.getTime() - from.getTime()) / DAY;
  const grain = spanDays > 120 ? "month" : spanDays > 45 ? "week" : "day";

  const pipeline = await prisma.pipeline.findFirst({ where: { organizationId }, orderBy: { createdAt: "asc" }, include: { stages: { orderBy: { position: "asc" } } } });
  const firstOpen = pipeline?.stages.find((s) => s.kind === "OPEN");

  const [
    totalCompanies,
    newCompanies,
    withoutWebsite,
    withoutContact,
    enrichmentGroups,
    qualified,
    openDeals,
    dealsByStage,
    wonInPeriod,
    lostInPeriod,
    dealsCreated,
    contactActivities,
    whatsappSent,
    whatsappReceived,
    tasksOpen,
    tasksOverdue,
    tasksDueToday,
    tasksDoneInPeriod,
    searchesInPeriod,
    auditsInPeriod,
    byCity,
    byCategory,
    scoreRows,
    notEvaluated,
    recentActivities,
    newSeries,
    contactSeries,
  ] = await Promise.all([
    prisma.company.count({ where: company }),
    prisma.company.count({ where: { ...company, createdAt: period } }),
    prisma.company.count({ where: { ...company, website: null } }),
    // mesmo critério do filtro "sem telefone" + "sem e-mail" da lista de empresas
    prisma.company.count({ where: { ...company, contacts: { none: { type: { in: ["PHONE", "WHATSAPP", "EMAIL"] }, status: { not: "INVALID" } } } } }),
    prisma.company.groupBy({ by: ["enrichmentStatus"], where: company, _count: true }),
    // qualificado = negociação aberta ou ganha que já saiu da primeira etapa do funil
    prisma.company.count({ where: { ...company, deals: { some: { status: { in: ["OPEN", "WON"] }, ...(firstOpen ? { stageId: { not: firstOpen.id } } : {}) } } } }),
    prisma.deal.aggregate({ where: { organizationId, status: "OPEN", ...viaCompany }, _count: true, _sum: { valueCents: true } }),
    prisma.deal.groupBy({ by: ["stageId"], where: { organizationId, status: { in: ["OPEN", "WON", "LOST"] }, ...viaCompany }, _count: true, _sum: { valueCents: true } }),
    prisma.deal.aggregate({ where: { organizationId, status: "WON", closedAt: period, ...viaCompany }, _count: true, _sum: { valueCents: true } }),
    prisma.deal.count({ where: { organizationId, status: "LOST", closedAt: period, ...viaCompany } }),
    prisma.deal.count({ where: { organizationId, createdAt: period, ...viaCompany } }),
    prisma.activity.groupBy({ by: ["type"], where: { organizationId, type: { in: [...CONTACT_ACTIVITY] }, occurredAt: period, ...viaCompany }, _count: true }),
    prisma.message.count({ where: { organizationId, direction: "OUTBOUND", status: { in: [...SENT_STATUSES] }, sentAt: period, ...(scoped ? { conversation: { company } } : {}) } }),
    prisma.message.count({ where: { organizationId, direction: "INBOUND", createdAt: period, ...(scoped ? { conversation: { company } } : {}) } }),
    prisma.task.count({ where: { organizationId, status: "OPEN", ...viaCompany } }),
    prisma.task.count({ where: { organizationId, status: "OPEN", dueAt: { lt: now }, ...viaCompany } }),
    prisma.task.count({ where: { organizationId, status: "OPEN", dueAt: { gte: now, lte: endOfToday }, ...viaCompany } }),
    prisma.task.count({ where: { organizationId, status: "DONE", completedAt: period, ...viaCompany } }),
    prisma.searchJob.aggregate({ where: { organizationId, createdAt: period }, _count: true, _sum: { newCount: true, resultCount: true } }),
    prisma.digitalAudit.count({ where: { organizationId, status: "COMPLETED", finishedAt: period, ...viaCompany } }),
    prisma.company.groupBy({ by: ["city"], where: { AND: [company, { city: { not: null } }] }, _count: true, orderBy: { _count: { city: "desc" } }, take: 8 }),
    prisma.company.groupBy({ by: ["category"], where: { AND: [company, { category: { not: null } }] }, _count: true, orderBy: { _count: { category: "desc" } }, take: 8 }),
    prisma.$queryRaw<{ kind: string; bucket: number; n: bigint }[]>`
      SELECT s.kind::text AS kind, LEAST(FLOOR(s.score / 20.0), 4)::int AS bucket, COUNT(*) AS n
      FROM company_scores s JOIN companies c ON c.id = s.company_id
      WHERE ${sqlScope} AND s.score IS NOT NULL
      GROUP BY 1, 2`,
    prisma.$queryRaw<{ kind: string; n: bigint }[]>`
      SELECT k.kind, COUNT(c.id) AS n
      FROM unnest(ARRAY[${Prisma.join([...SCORE_KINDS])}]::text[]) AS k(kind)
      JOIN companies c ON ${sqlScope}
      LEFT JOIN company_scores s ON s.company_id = c.id AND s.kind::text = k.kind
      WHERE s.score IS NULL
      GROUP BY 1`,
    prisma.activity.findMany({
      where: { organizationId, ...viaCompany },
      orderBy: { occurredAt: "desc" },
      take: 12,
      select: { id: true, type: true, title: true, occurredAt: true, company: { select: { id: true, name: true } }, user: { select: { name: true } } },
    }),
    prisma.$queryRaw<{ bucket: string; n: bigint }[]>`
      SELECT to_char(date_trunc(${grain}, (c.created_at AT TIME ZONE 'UTC') AT TIME ZONE ${TZ}), 'YYYY-MM-DD') AS bucket, COUNT(*) AS n
      FROM companies c
      WHERE ${sqlScope} AND c.created_at BETWEEN ${from} AND ${to}
      GROUP BY 1 ORDER BY 1`,
    prisma.$queryRaw<{ bucket: string; n: bigint }[]>`
      SELECT to_char(date_trunc(${grain}, (a.occurred_at AT TIME ZONE 'UTC') AT TIME ZONE ${TZ}), 'YYYY-MM-DD') AS bucket, COUNT(*) AS n
      FROM activities a ${scoped ? Prisma.sql`JOIN companies c ON c.id = a.company_id AND ${sqlScope}` : Prisma.empty}
      WHERE a.organization_id = ${organizationId}::uuid AND a.type::text IN (${Prisma.join([...CONTACT_ACTIVITY])}) AND a.occurred_at BETWEEN ${from} AND ${to}
      GROUP BY 1 ORDER BY 1`,
  ]);

  const closed = wonInPeriod._count + lostInPeriod;
  const distribution = Object.fromEntries(
    SCORE_KINDS.map((k) => {
      const counts = BUCKETS.map((label, i) => ({ label, count: Number(scoreRows.find((r) => r.kind === k && r.bucket === i)?.n ?? 0) }));
      return [k, { buckets: counts, notEvaluated: Number(notEvaluated.find((r) => r.kind === k)?.n ?? 0) }];
    }),
  );
  const opportunityHigh = (distribution.OPPORTUNITY?.buckets ?? []).slice(3).reduce((a, b) => a + b.count, 0);
  const dataQualityLow = (distribution.DATA_QUALITY?.buckets ?? []).slice(0, 3).reduce((a, b) => a + b.count, 0);
  const contacts = Object.fromEntries(CONTACT_ACTIVITY.map((t) => [t, contactActivities.find((r) => r.type === t)?._count ?? 0])) as Record<(typeof CONTACT_ACTIVITY)[number], number>;

  return {
    period: { from: from.toISOString(), to: to.toISOString(), grain, timezone: TZ },
    filters: { city: q.city ?? null, category: q.category ?? null },
    leads: {
      total: totalCompanies,
      newInPeriod: newCompanies,
      qualified,
      withoutWebsite,
      withoutContact,
      /** Qualidade dos dados abaixo de 60 (pontuação calculada pela metodologia) */
      incompleteData: dataQualityLow,
      /** Oportunidade comercial ≥ 60 */
      highOpportunity: opportunityHigh,
      enrichment: Object.fromEntries(enrichmentGroups.map((g) => [g.enrichmentStatus, g._count])),
    },
    pipeline: {
      name: pipeline?.name ?? null,
      openDeals: openDeals._count,
      openValueCents: openDeals._sum.valueCents ?? 0,
      dealsCreated,
      wonInPeriod: wonInPeriod._count,
      wonValueCents: wonInPeriod._sum.valueCents ?? 0,
      lostInPeriod,
      /** ganhos ÷ (ganhos + perdidos) fechados no período; null sem fechamentos */
      winRate: closed ? wonInPeriod._count / closed : null,
      stages: (pipeline?.stages ?? []).map((s) => {
        const g = dealsByStage.find((d) => d.stageId === s.id);
        return { id: s.id, name: s.name, color: s.color, kind: s.kind, count: g?._count ?? 0, valueCents: g?._sum.valueCents ?? 0 };
      }),
    },
    activity: {
      contacts: { calls: contacts.CALL, meetings: contacts.MEETING, emails: contacts.EMAIL, whatsappSent, total: contacts.CALL + contacts.MEETING + contacts.EMAIL + whatsappSent },
      whatsappReceived,
      tasks: { open: tasksOpen, overdue: tasksOverdue, dueToday: tasksDueToday, doneInPeriod: tasksDoneInPeriod },
      searches: { count: searchesInPeriod._count, newCompanies: searchesInPeriod._sum.newCount ?? 0, results: searchesInPeriod._sum.resultCount ?? 0 },
      auditsCompleted: auditsInPeriod,
      recent: recentActivities,
    },
    segments: {
      byCity: byCity.map((c) => ({ label: c.city!, count: c._count })),
      byCategory: byCategory.map((c) => ({ label: c.category!, count: c._count })),
    },
    scores: distribution,
    series: {
      newCompanies: newSeries.map((r) => ({ bucket: r.bucket, count: Number(r.n) })),
      contacts: contactSeries.map((r) => ({ bucket: r.bucket, count: Number(r.n) })),
    },
  };
}

export type DashboardMetrics = Awaited<ReturnType<typeof dashboardMetrics>>;
