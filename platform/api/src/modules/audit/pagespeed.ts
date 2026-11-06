import { assertSafeUrl } from "../../lib/safe-fetch.ts";
import { sourceKey } from "../public-data/credentials.ts";
import { publicMockActive, requestJson, SourceError, tracked } from "../public-data/http.ts";
import type { LighthouseSummary } from "./evaluate.ts";

/**
 * Google PageSpeed Insights API v5: Lighthouse remoto (celular e computador) e, quando o site tem tráfego
 * suficiente, dados reais de usuários do Chrome (CrUX), a única fonte válida para INP. Exige chave gratuita
 * da conta (sem ela a cota anônima do Google costuma devolver 429). A URL do site é enviada ao Google.
 */
const BASE = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";

type Metric = { percentile?: number; category?: string };
type PsiResponse = {
  lighthouseResult?: { finalDisplayedUrl?: string; categories?: Record<string, { score?: number | null }>; audits?: Record<string, { numericValue?: number }> };
  loadingExperience?: { overall_category?: string; origin_fallback?: boolean; metrics?: Record<string, Metric> };
};

export type FieldData = { overall: string | null; originFallback: boolean; inpMs: number | null; inpCategory: string | null; lcpMs: number | null; lcpCategory: string | null; cls: number | null; clsCategory: string | null };
export type PageSpeedRun = {
  strategy: "mobile" | "desktop";
  performance: number | null;
  seo: number | null;
  accessibility: number | null;
  bestPractices: number | null;
  lcpMs: number | null;
  cls: number | null;
  tbtMs: number | null;
  fcpMs: number | null;
  field: FieldData | null;
  finalUrl: string;
  fetchedAt: string;
  simulated: boolean;
};

export function parsePsi(r: PsiResponse, strategy: "mobile" | "desktop", url: string, simulated: boolean): PageSpeedRun {
  const lh = r.lighthouseResult ?? {};
  const score = (k: string) => lh.categories?.[k]?.score ?? null;
  const num = (id: string) => (typeof lh.audits?.[id]?.numericValue === "number" ? lh.audits[id]!.numericValue! : null);
  const m = r.loadingExperience?.metrics;
  const field: FieldData | null = m
    ? {
        overall: r.loadingExperience?.overall_category ?? null,
        originFallback: r.loadingExperience?.origin_fallback === true,
        inpMs: m.INTERACTION_TO_NEXT_PAINT?.percentile ?? null,
        inpCategory: m.INTERACTION_TO_NEXT_PAINT?.category ?? null,
        lcpMs: m.LARGEST_CONTENTFUL_PAINT_MS?.percentile ?? null,
        lcpCategory: m.LARGEST_CONTENTFUL_PAINT_MS?.category ?? null,
        // o CrUX publica o CLS multiplicado por 100
        cls: m.CUMULATIVE_LAYOUT_SHIFT_SCORE?.percentile != null ? m.CUMULATIVE_LAYOUT_SHIFT_SCORE.percentile / 100 : null,
        clsCategory: m.CUMULATIVE_LAYOUT_SHIFT_SCORE?.category ?? null,
      }
    : null;
  const lcp = num("largest-contentful-paint");
  const cls = num("cumulative-layout-shift");
  const tbt = num("total-blocking-time");
  const fcp = num("first-contentful-paint");
  return {
    strategy,
    performance: score("performance"),
    seo: score("seo"),
    accessibility: score("accessibility"),
    bestPractices: score("best-practices"),
    lcpMs: lcp != null ? Math.round(lcp) : null,
    cls: cls != null ? Number(cls.toFixed(3)) : null,
    tbtMs: tbt != null ? Math.round(tbt) : null,
    fcpMs: fcp != null ? Math.round(fcp) : null,
    field,
    finalUrl: lh.finalDisplayedUrl ?? url,
    fetchedAt: new Date().toISOString(),
    simulated,
  };
}

export async function runPageSpeed(organizationId: string, companyId: string | null, url: string, strategy: "mobile" | "desktop", maxDaily: number): Promise<PageSpeedRun> {
  try {
    assertSafeUrl(url);
  } catch {
    throw new SourceError("BLOCKED");
  }
  const simulated = publicMockActive();
  const key = await sourceKey(organizationId, "pagespeed");
  if (!key && !simulated) throw new SourceError("NOT_CONFIGURED");
  const qs = new URLSearchParams({ url, strategy });
  for (const c of ["performance", "seo", "accessibility", "best-practices"]) qs.append("category", c);
  if (key) qs.set("key", key);
  return tracked({ source: "pagespeed", operation: "company", organizationId, companyId }, async () => {
    const r = await requestJson<PsiResponse>("pagespeed", `${BASE}?${qs}`, { organizationId, maxDaily, timeoutMs: 120_000 });
    if (!r?.lighthouseResult) throw new SourceError("UNAVAILABLE", "resposta sem resultado do Lighthouse");
    return { value: parsePsi(r, strategy, url, simulated), records: 1 };
  });
}

/** Resultado de laboratório do PageSpeed no formato do Lighthouse local (quando o Chromium não está disponível). */
export function asLighthouse(run: PageSpeedRun): LighthouseSummary {
  return { performance: run.performance, accessibility: run.accessibility, bestPractices: run.bestPractices, seo: run.seo, lcpMs: run.lcpMs, cls: run.cls, tbtMs: run.tbtMs, fcpMs: run.fcpMs, formFactor: "mobile", fetchedAt: run.fetchedAt, finalUrl: run.finalUrl, source: "pagespeed" };
}
