import { basename } from "node:path";
import { Prisma } from "../../../lib/prisma.ts";
import { columnSkeleton, runImport, type ImportResult } from "./runner.ts";

/**
 * Novo CAGED — microdados de movimentação (arquivos CAGEDMOV<AAAAMM>.txt, extraídos do .7z do MTE; separador ";",
 * com cabeçalho). Só quatro colunas são lidas (competência, município, seção, saldo) e somadas por
 * competência × município × seção: nenhum dado de trabalhador é guardado.
 *
 * CAGEDFOR (declarações fora do prazo) e CAGEDEXC (exclusões) ainda não são aplicados: o saldo pode diferir
 * levemente dos números oficiais divulgados pelo MTE.
 */
export const UF_CODES: Record<string, string> = { RO: "11", AC: "12", AM: "13", RR: "14", PA: "15", AP: "16", TO: "17", MA: "21", PI: "22", CE: "23", RN: "24", PB: "25", PE: "26", AL: "27", SE: "28", BA: "29", MG: "31", ES: "32", RJ: "33", SP: "35", PR: "41", SC: "42", RS: "43", MS: "50", MT: "51", GO: "52", DF: "53" };

export function cagedColumns(header: string[]) {
  const sk = header.map(columnSkeleton);
  const find = (test: (s: string) => boolean) => sk.findIndex(test);
  const cols = {
    period: find((s) => s.startsWith("compet") && s.includes("mov")),
    city: find((s) => s.startsWith("munic")),
    section: find((s) => s === "seo" || s === "secao" || s === "seao"),
    balance: find((s) => s.startsWith("saldomov")),
  };
  const missing = Object.entries(cols).filter(([, i]) => i < 0).map(([k]) => k);
  if (missing.length) throw new Error(`Cabeçalho do CAGED sem as colunas: ${missing.join(", ")}. Confira se o arquivo é um CAGEDMOV extraído.`);
  return cols;
}

export async function importCaged(filePath: string, o: { uf?: string; city?: string; encoding?: "utf8" | "latin1"; redo?: boolean; signal?: AbortSignal; batchSize?: number; log?: (m: string) => void } = {}): Promise<ImportResult> {
  const file = basename(filePath);
  const ufCode = o.uf ? UF_CODES[o.uf] : undefined;
  if (o.uf && !ufCode) throw new Error(`UF desconhecida: ${o.uf}`);
  const city6 = o.city?.replace(/\D/g, "").slice(0, 6);
  return runImport({
    source: "caged",
    kind: "caged_mov",
    filePath,
    encoding: o.encoding ?? "utf8",
    delimiter: ";",
    header: true,
    filters: { ...(o.uf ? { uf: o.uf } : {}), ...(city6 ? { city: city6 } : {}) },
    redo: o.redo,
    signal: o.signal,
    batchSize: o.batchSize ?? 5000,
    log: o.log,
    onRedo: async (tx) => void (await tx.laborStat.deleteMany({ where: { sourceFile: file } })),
    onBatch: async (rows, header, tx) => {
      const c = cagedColumns(header ?? []);
      const agg = new Map<string, { period: string; city: string; section: string; hires: number; separations: number; balance: number }>();
      let used = 0;
      for (const r of rows) {
        const period = (r[c.period] ?? "").replace(/\D/g, "");
        const city = (r[c.city] ?? "").replace(/\D/g, "").slice(0, 6);
        const section = (r[c.section] ?? "").trim().toUpperCase().slice(0, 1);
        const saldo = Number(r[c.balance]);
        if (period.length !== 6 || city.length !== 6 || !/^[A-U]$/.test(section) || !Number.isFinite(saldo) || saldo === 0) continue;
        if (ufCode && !city.startsWith(ufCode)) continue;
        if (city6 && city !== city6) continue;
        const key = `${period}|${city}|${section}`;
        const a = agg.get(key) ?? { period, city, section, hires: 0, separations: 0, balance: 0 };
        if (saldo > 0) a.hires += 1;
        else a.separations += 1;
        a.balance += saldo;
        agg.set(key, a);
        used++;
      }
      if (agg.size)
        await tx.$executeRaw`INSERT INTO labor_stats (id, source_file, period, city_code, section, hires, separations, balance)
          VALUES ${Prisma.join([...agg.values()].map((a) => Prisma.sql`(gen_random_uuid(), ${file}, ${a.period}, ${a.city}, ${a.section}, ${a.hires}, ${a.separations}, ${a.balance})`))}
          ON CONFLICT (source_file, period, city_code, section) DO UPDATE SET hires = labor_stats.hires + EXCLUDED.hires,
            separations = labor_stats.separations + EXCLUDED.separations, balance = labor_stats.balance + EXCLUDED.balance`;
      return used;
    },
  });
}
