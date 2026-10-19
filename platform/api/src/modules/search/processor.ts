import type { Job } from "bullmq";
import { prisma, type Prisma } from "../../lib/prisma.ts";
import { redis } from "../../lib/redis.ts";
import { logger } from "../../lib/logger.ts";
import type { SearchJobData } from "../../queues/index.ts";
import { upsertDiscovered } from "../companies/upsert.ts";
import { mapCsvRow, type ColumnMapping } from "../imports/csv-import.ts";
import { CancelledError, matchesFilters, searchFiltersSchema, searchParamsSchema, type DiscoveredCompany, type ProgressUpdate } from "../sources/types.ts";
import { getAdapter } from "./registry.ts";
import { recomputeDataQuality } from "../audit/service.ts";

export const csvRowsKey = (searchJobId: string) => `pp:csvjob:${searchJobId}`;

type CsvJobParams = { fileName: string; format: "gosom" | "generic"; mapping: ColumnMapping; totalRows: number; filters?: unknown; saveOnlyMatching?: boolean };

/** Executa uma busca/importação: coleta na fonte, filtra, deduplica e grava com procedência. */
export async function processSearchJob(job: Job<SearchJobData>) {
  const id = job.data.searchJobId;
  const sj = await prisma.searchJob.findUnique({ where: { id } });
  if (!sj) return;
  if (["COMPLETED", "CANCELLED", "FAILED"].includes(sj.status)) return;
  const log = logger.child({ searchJobId: id, provider: sj.provider });

  let progress: Record<string, unknown> = { phase: "starting", message: "Iniciando…" };
  const saveProgress = async (p: ProgressUpdate, status?: Prisma.SearchJobUpdateInput["status"]) => {
    progress = { ...progress, ...p, updatedAt: new Date().toISOString() };
    await prisma.searchJob.update({ where: { id }, data: { progress: progress as Prisma.InputJsonValue, ...(status ? { status } : {}) } });
  };
  const isCancelled = async () => !!(await prisma.searchJob.findUnique({ where: { id }, select: { cancelRequested: true } }))?.cancelRequested;

  await prisma.searchJob.update({ where: { id }, data: { status: sj.provider === "CSV_IMPORT" ? "IMPORTING" : "RUNNING", startedAt: new Date(), attempts: { increment: 1 } } });

  let providerJobId = sj.providerJobId;
  const adapter = sj.provider === "CSV_IMPORT" ? null : getAdapter(sj.provider);
  try {
    let records: DiscoveredCompany[];
    let filters = searchFiltersSchema.parse({});
    let saveOnlyMatching = false;
    let fallbackCity: string | null = null;
    let fallbackState: string | null = null;
    let sourceRef: string;

    if (sj.provider === "CSV_IMPORT") {
      const params = sj.params as unknown as CsvJobParams;
      const raw = await redis.get(csvRowsKey(id));
      if (!raw) throw new Error("O conteúdo do arquivo expirou antes da importação. Envie o CSV novamente.");
      const rows = JSON.parse(raw) as Record<string, string>[];
      records = rows.map((r) => mapCsvRow(r, params.mapping, params.format)).filter((r): r is DiscoveredCompany => !!r);
      filters = searchFiltersSchema.parse(params.filters ?? {});
      saveOnlyMatching = !!params.saveOnlyMatching;
      sourceRef = params.fileName;
      await saveProgress({ phase: "importing", message: `${records.length} linhas válidas de ${rows.length} no arquivo.`, found: records.length });
    } else {
      if (!adapter) throw new Error(`Fonte desconhecida: ${sj.provider}`);
      const params = searchParamsSchema.parse(sj.params);
      const avail = await adapter.available();
      if (!avail.ok) throw new Error(`Fonte indisponível: ${avail.reason ?? "sem detalhes"}`);
      filters = params.filters;
      saveOnlyMatching = params.saveOnlyMatching;
      fallbackCity = params.city;
      fallbackState = params.state ?? null;
      sourceRef = sj.name;
      records = await adapter.run({
        searchJobId: id,
        params,
        progress: (p) => saveProgress(p, p.phase === "running" ? "RUNNING" : undefined),
        isCancelled,
        setProviderJobId: async (pid) => {
          providerJobId = pid;
          await prisma.searchJob.update({ where: { id }, data: { providerJobId: pid, status: "SUBMITTED" } });
        },
        log: (msg, extra) => log.info(extra ?? {}, msg),
      });
      await prisma.searchJob.update({ where: { id }, data: { status: "IMPORTING" } });
    }

    if (await isCancelled()) throw new CancelledError();
    let imported = 0;
    let duplicates = 0;
    let filteredOut = 0;
    let processed = 0;
    const total = records.length;
    for (const [i, rec] of records.entries()) {
      const matches = matchesFilters(rec, filters);
      if (!matches && saveOnlyMatching) {
        filteredOut++;
        await prisma.searchResult.create({
          data: { searchJobId: id, position: i + 1, title: rec.name.slice(0, 200), isNew: false, matchedBy: "filtered_out", rawData: rec.raw as Prisma.InputJsonValue },
        });
      } else {
        const r = await upsertDiscovered(
          { organizationId: sj.organizationId, source: sj.provider, sourceRef, searchJobId: id, userId: sj.createdById, fallbackCity, fallbackState },
          rec,
        );
        await recomputeDataQuality(r.companyId).catch(() => undefined);
        if (r.isNew) imported++;
        else duplicates++;
        await prisma.searchResult.create({
          data: { searchJobId: id, companyId: r.companyId, position: i + 1, title: rec.name.slice(0, 200), isNew: r.isNew, matchedBy: r.matchedBy, rawData: rec.raw as Prisma.InputJsonValue },
        });
      }
      processed++;
      if (processed % 5 === 0 || processed === total) {
        await saveProgress({ phase: "importing", message: `Gravando empresas (${processed}/${total})…`, processed, imported, duplicates, filteredOut, found: total, percent: Math.round((processed / Math.max(1, total)) * 100) });
        if (processed % 20 === 0 && (await isCancelled())) throw new CancelledError();
      }
    }

    await prisma.searchJob.update({
      where: { id },
      data: {
        status: "COMPLETED",
        finishedAt: new Date(),
        resultCount: total,
        newCount: imported,
        duplicateCount: duplicates,
        progress: { ...progress, phase: "done", message: total ? `Concluída: ${imported} novas, ${duplicates} já existentes${filteredOut ? `, ${filteredOut} fora dos filtros` : ""}.` : "Concluída sem resultados para esses critérios.", processed, imported, duplicates, filteredOut, found: total, percent: 100 },
      },
    });
    log.info({ total, imported, duplicates, filteredOut }, "busca concluída");
  } catch (err) {
    const cancelled = err instanceof CancelledError;
    const message = cancelled ? "Cancelada pelo usuário." : (err as Error).message?.slice(0, 500) || "Erro desconhecido";
    await prisma.searchJob.update({
      where: { id },
      data: { status: cancelled ? "CANCELLED" : "FAILED", finishedAt: new Date(), error: cancelled ? null : message, progress: { ...progress, phase: cancelled ? "cancelled" : "failed", message } },
    });
    if (!cancelled) log.error({ err: message }, "busca falhou");
  } finally {
    if (adapter?.cleanup && providerJobId) await adapter.cleanup(providerJobId);
    if (sj.provider === "CSV_IMPORT") await redis.del(csvRowsKey(id));
  }
}
