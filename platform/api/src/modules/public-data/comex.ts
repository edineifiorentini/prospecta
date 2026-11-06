import { cachedFetch } from "./cache.ts";
import { requestJson, tracked } from "./http.ts";

/**
 * Comex Stat (MDIC) — API oficial (api-comexstat.mdic.gov.br, conferida em 03/11/2026): exportações e importações
 * por MUNICÍPIO do domicílio fiscal de quem declarou. Agregado: nunca é atribuído a uma empresa.
 */
const BASE = "https://api-comexstat.mdic.gov.br";

type Row = {
  year: string;
  monthNumber?: string;
  headingCode?: string;
  heading?: string;
  country?: string;
  metricFOB: string;
  metricKG: string;
};
type ListResp = { data?: { list?: Row[] } };

export type Flow = "export" | "import";
export type FlowSummary = {
  flow: Flow;
  /** último ano completo e ano corrente até o último mês publicado */
  years: { year: string; fob: number; kg: number; partial: boolean }[];
  monthly: { period: string; fob: number }[];
  /** acumulado do ano corrente comparado ao mesmo período do ano anterior */
  ytd: {
    year: string;
    months: number;
    fob: number;
    previousFob: number;
    changePct: number | null;
  } | null;
  topProducts: { code: string; name: string; fob: number; kg: number }[];
  topCountries: { name: string; fob: number }[];
};
export type ComexPanel = {
  city: string;
  updatedUntil: string;
  flows: FlowSummary[];
};

type Ctx = { organizationId: string | null; maxDaily?: number };

const num = (v: string | undefined) => Number(v ?? 0) || 0;

async function query(body: unknown, ctx: Ctx) {
  return (
    (
      await requestJson<ListResp>("comexstat", `${BASE}/cities`, {
        ...ctx,
        method: "POST",
        body,
        timeoutMs: 60_000,
      })
    )?.data?.list ?? []
  );
}

export function summarize(
  flow: Flow,
  rows: Row[],
  countries: Row[],
  lastYear: number,
  currentYear: number,
  lastMonth: number,
): FlowSummary {
  const byYear = new Map<string, { fob: number; kg: number }>();
  const byMonth = new Map<string, number>();
  const byProduct = new Map<
    string,
    { code: string; name: string; fob: number; kg: number }
  >();
  for (const r of rows) {
    const y = byYear.get(r.year) ?? { fob: 0, kg: 0 };
    y.fob += num(r.metricFOB);
    y.kg += num(r.metricKG);
    byYear.set(r.year, y);
    if (r.monthNumber)
      byMonth.set(
        `${r.year}-${r.monthNumber}`,
        (byMonth.get(`${r.year}-${r.monthNumber}`) ?? 0) + num(r.metricFOB),
      );
    if (r.year === String(lastYear) && r.headingCode) {
      const p = byProduct.get(r.headingCode) ?? {
        code: r.headingCode,
        name: r.heading ?? r.headingCode,
        fob: 0,
        kg: 0,
      };
      p.fob += num(r.metricFOB);
      p.kg += num(r.metricKG);
      byProduct.set(r.headingCode, p);
    }
  }
  const sumMonths = (year: number) =>
    [...byMonth.entries()]
      .filter(
        ([k]) => k.startsWith(`${year}-`) && Number(k.slice(5)) <= lastMonth,
      )
      .reduce((s, [, v]) => s + v, 0);
  const cur = sumMonths(currentYear);
  const prev = sumMonths(currentYear - 1);
  const byCountry = new Map<string, number>();
  for (const r of countries)
    if (r.country)
      byCountry.set(
        r.country,
        (byCountry.get(r.country) ?? 0) + num(r.metricFOB),
      );
  return {
    flow,
    years: [...byYear.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([year, v]) => ({
        year,
        ...v,
        partial: Number(year) === currentYear,
      })),
    monthly: [...byMonth.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([period, fob]) => ({ period, fob })),
    ytd: byMonth.size
      ? {
          year: String(currentYear),
          months: lastMonth,
          fob: cur,
          previousFob: prev,
          changePct:
            prev > 0 ? Math.round(((cur - prev) / prev) * 1000) / 10 : null,
        }
      : null,
    topProducts: [...byProduct.values()]
      .sort((a, b) => b.fob - a.fob)
      .slice(0, 5),
    topCountries: [...byCountry.entries()]
      .map(([name, fob]) => ({ name, fob }))
      .sort((a, b) => b.fob - a.fob)
      .slice(0, 5),
  };
}

/** Painel de comércio exterior do município (cache global). */
export async function comexPanel(
  cityIbge: string,
  ctx: Ctx & { cacheDays: number; force?: boolean },
) {
  return cachedFetch<ComexPanel>(
    "comexstat",
    `municipio:${cityIbge}`,
    ctx.cacheDays,
    () =>
      tracked(
        {
          source: "comexstat",
          operation: "regional",
          organizationId: ctx.organizationId,
        },
        async () => {
          const updated = (
            await requestJson<{
              data?: { year?: string; monthNumber?: string };
            }>("comexstat", `${BASE}/general/dates/updated`, ctx)
          )?.data;
          const currentYear = Number(updated?.year ?? new Date().getFullYear());
          const lastMonth = Number(updated?.monthNumber ?? 12);
          const lastYear = currentYear - 1;
          const filters = [{ filter: "city", values: [Number(cityIbge)] }];
          const metrics = ["metricFOB", "metricKG"];
          const flows: FlowSummary[] = [];
          for (const flow of ["export", "import"] as Flow[]) {
            const rows = await query(
              {
                flow,
                monthDetail: true,
                period: {
                  from: `${lastYear - 1}-01`,
                  to: `${currentYear}-${String(lastMonth).padStart(2, "0")}`,
                },
                filters,
                details: ["heading"],
                metrics,
              },
              ctx,
            );
            const countries = await query(
              {
                flow,
                monthDetail: false,
                period: { from: `${lastYear}-01`, to: `${lastYear}-12` },
                filters,
                details: ["country"],
                metrics,
              },
              ctx,
            );
            flows.push(
              summarize(
                flow,
                rows,
                countries,
                lastYear,
                currentYear,
                lastMonth,
              ),
            );
          }
          return {
            value: {
              payload: {
                city: cityIbge,
                updatedUntil: `${currentYear}-${String(lastMonth).padStart(2, "0")}`,
                flows,
              },
              referencePeriod: `${currentYear}-${String(lastMonth).padStart(2, "0")}`,
            },
            records: flows.reduce((n, f) => n + f.years.length, 0),
          };
        },
      ),
    { force: ctx.force },
  );
}
