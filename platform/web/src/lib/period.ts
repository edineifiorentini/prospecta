"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export type PeriodKey = "7d" | "30d" | "90d" | "12m" | "ytd" | "custom";
export const PERIOD_LABEL: Record<Exclude<PeriodKey, "custom">, string> = { "7d": "7 dias", "30d": "30 dias", "90d": "90 dias", "12m": "12 meses", ytd: "Ano" };

const TZ = "America/Sao_Paulo";
// São Paulo não tem horário de verão desde 2019
const OFFSET = "-03:00";
const ymd = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
const DAY = 86_400_000;

export function periodRange(key: PeriodKey, customFrom?: string | null, customTo?: string | null) {
  const now = new Date();
  const today = ymd(now);
  if (key === "custom" && customFrom && customTo) {
    const [a, b] = customFrom <= customTo ? [customFrom, customTo] : [customTo, customFrom];
    return { from: `${a}T00:00:00${OFFSET}`, to: `${b}T23:59:59.999${OFFSET}` };
  }
  const days = key === "7d" ? 7 : key === "90d" ? 90 : key === "12m" ? 365 : 30;
  const start = key === "ytd" ? `${today.slice(0, 4)}-01-01` : ymd(new Date(now.getTime() - (days - 1) * DAY));
  return { from: `${start}T00:00:00${OFFSET}`, to: `${today}T23:59:59.999${OFFSET}` };
}

export type DashboardFilters = { period: PeriodKey; from: string | null; to: string | null; city: string | null; category: string | null };

/** Período e filtros guardados na URL (links compartilháveis entre painel e relatórios). */
export function useDashboardFilters() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const raw = params.get("p") as PeriodKey | null;
  const filters: DashboardFilters = {
    period: raw && ["7d", "30d", "90d", "12m", "ytd", "custom"].includes(raw) ? raw : "30d",
    from: params.get("from"),
    to: params.get("to"),
    city: params.get("city"),
    category: params.get("category"),
  };
  const key = `${filters.period}|${filters.from}|${filters.to}|${filters.city}|${filters.category}`;
  const query = useMemo(() => {
    const r = periodRange(filters.period, filters.from, filters.to);
    return { from: r.from, to: r.to, city: filters.city ?? undefined, category: filters.category ?? undefined };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const update = useCallback(
    (patch: Partial<DashboardFilters>) => {
      const next = new URLSearchParams(params.toString());
      const map: Record<string, string | null | undefined> = { p: patch.period, from: patch.from, to: patch.to, city: patch.city, category: patch.category };
      for (const [k, v] of Object.entries(map)) {
        if (v === undefined) continue;
        if (v === null || v === "") next.delete(k);
        else next.set(k, v);
      }
      if (patch.period && patch.period !== "custom") {
        next.delete("from");
        next.delete("to");
      }
      if (next.get("p") === "30d") next.delete("p");
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  return { filters, query, update };
}

/** Preenche intervalos sem registros para o eixo do gráfico ficar contínuo. */
export function fillSeries(from: string, to: string, grain: "day" | "week" | "month", series: Record<string, { bucket: string; count: number }[]>) {
  const keys: string[] = [];
  const start = new Date(`${ymd(new Date(from))}T12:00:00Z`);
  const end = new Date(`${ymd(new Date(to))}T12:00:00Z`);
  if (grain === "month") start.setUTCDate(1);
  if (grain === "week") start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7)); // segunda-feira (date_trunc week)
  for (let d = new Date(start); d <= end && keys.length < 400; ) {
    keys.push(d.toISOString().slice(0, 10));
    if (grain === "day") d.setUTCDate(d.getUTCDate() + 1);
    else if (grain === "week") d.setUTCDate(d.getUTCDate() + 7);
    else d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return keys.map((k) => {
    const row: Record<string, string | number> = { bucket: k };
    for (const [name, s] of Object.entries(series)) row[name] = s.find((x) => x.bucket === k)?.count ?? 0;
    return row;
  });
}

export function bucketLabel(bucket: string, grain: "day" | "week" | "month") {
  const d = new Date(`${bucket}T12:00:00Z`);
  if (grain === "month") return d.toLocaleDateString("pt-BR", { month: "short", year: "2-digit", timeZone: "UTC" });
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" });
}
