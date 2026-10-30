import { z } from "zod";
import { prisma, type Prisma } from "../../lib/prisma.ts";
import { AppError } from "../../lib/errors.ts";

/**
 * Limites de pesquisa por conta, definidos só pelo administrador da plataforma (colunas da
 * organização, fora das configurações que a própria conta edita). Protegem o IP do servidor:
 * - pesquisas por dia (horário de Brasília), contando qualquer fonte de coleta, exceto CSV;
 * - total de empresas trazidas por pesquisas: as concluídas contam o que trouxeram e as em
 *   andamento reservam o teto delas, para pesquisas simultâneas não passarem do limite.
 */

export const searchLimitsSchema = z.object({
  searchesPerDay: z.number().int().min(1).max(1000).nullable(),
  maxCompanies: z.number().int().min(1).max(1_000_000).nullable(),
});
export type SearchLimits = z.infer<typeof searchLimitsSchema>;

const ACTIVE = ["QUEUED", "SUBMITTED", "RUNNING", "DOWNLOADING", "IMPORTING"] as const;
const COLLECTED = { not: "CSV_IMPORT" } as const;

type Db = Prisma.TransactionClient | typeof prisma;

/** Início do dia em Brasília (sem horário de verão desde 2019: UTC−3). */
export function startOfDayBR(now = new Date()) {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return new Date(`${ymd}T00:00:00-03:00`);
}

/** Teto de empresas de uma pesquisa: o cortado pelo limite da conta, ou o pedido. */
export const capOf = (params: unknown) => {
  const p = (params ?? {}) as { quotaCap?: number; limit?: number };
  return p.quotaCap ?? p.limit ?? 0;
};

export async function searchUsage(db: Db, organizationId: string, now = new Date()) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { searchDailyLimit: true, companyQuota: true } });
  const since = startOfDayBR(now);
  const [searchesToday, done, active] = await Promise.all([
    // cancelada antes de começar não chegou a usar o motor de coleta
    db.searchJob.count({ where: { organizationId, provider: COLLECTED, createdAt: { gte: since }, NOT: { status: "CANCELLED", startedAt: null } } }),
    db.searchJob.aggregate({ where: { organizationId, provider: COLLECTED, status: "COMPLETED" }, _sum: { resultCount: true } }),
    db.searchJob.findMany({ where: { organizationId, provider: COLLECTED, status: { in: [...ACTIVE] } }, select: { params: true } }),
  ]);
  const companiesUsed = done._sum.resultCount ?? 0;
  const companiesReserved = active.reduce((s, j) => s + capOf(j.params), 0);
  return {
    searchesPerDay: org.searchDailyLimit,
    searchesToday,
    maxCompanies: org.companyQuota,
    companiesUsed,
    companiesReserved,
    companiesRemaining: org.companyQuota == null ? null : Math.max(0, org.companyQuota - companiesUsed - companiesReserved),
    resetsAt: new Date(since.getTime() + 86_400_000),
  };
}

const quotaExceeded = (message: string) => new AppError(429, "QUOTA_EXCEEDED", message);

/**
 * Dentro de uma transação: trava a conta, confere os limites e devolve o teto de empresas da nova
 * pesquisa (null = sem limite de empresas). Chamado antes de criar qualquer pesquisa de coleta.
 */
export async function reserveSearch(tx: Prisma.TransactionClient, organizationId: string, requested: number) {
  // uma criação de pesquisa por conta de cada vez: duas ao mesmo tempo não furam o limite
  await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${organizationId}::uuid FOR UPDATE`;
  const u = await searchUsage(tx, organizationId);
  if (u.searchesPerDay != null && u.searchesToday >= u.searchesPerDay) {
    throw quotaExceeded(`Limite diário de pesquisas desta conta atingido (${u.searchesToday} de ${u.searchesPerDay}). Libera de novo amanhã, à 0h (horário de Brasília).`);
  }
  if (u.companiesRemaining == null) return null;
  if (u.companiesRemaining <= 0) {
    const pending = u.companiesReserved ? `, contando ${u.companiesReserved} reservadas por pesquisas em andamento` : "";
    throw quotaExceeded(`Limite de empresas desta conta atingido (${u.companiesUsed + u.companiesReserved} de ${u.maxCompanies}${pending}). Para pesquisar mais, fale com o administrador da plataforma.`);
  }
  return Math.min(requested, u.companiesRemaining);
}

/** Parâmetros da pesquisa com o teto aplicado: o motor nem procura além do que a conta ainda pode trazer. */
export function applyCap<T extends { limit: number }>(params: T, cap: number | null): T & { quotaCap?: number } {
  if (cap == null || cap >= params.limit) return params;
  // o motor aceita no mínimo 5; o excedente é descartado antes de gravar (processor.ts)
  return { ...params, limit: Math.max(5, cap), quotaCap: cap };
}
