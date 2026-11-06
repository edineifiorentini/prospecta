import { prisma } from "../../lib/prisma.ts";
import { CNAE_SECTIONS } from "./ibge.ts";

/**
 * Tendências do emprego no MUNICÍPIO (Novo CAGED importado): saldo de admissões e desligamentos por mês e por
 * seção CNAE. É movimento do setor na cidade, não o quadro de funcionários de uma empresa.
 */
const SECTION_NAME = Object.fromEntries(Object.values(CNAE_SECTIONS).map((s) => [s.letter, s.name]));

export type LaborPanel = {
  available: boolean;
  city6: string;
  periods: string[];
  monthly: { period: string; hires: number; separations: number; balance: number }[];
  bySection: { section: string; name: string; hires: number; separations: number; balance: number }[];
  highlight: { section: string; name: string; balance: number; hires: number; separations: number } | null;
};

export async function laborPanel(cityIbge: string, highlightSection: string | null, months = 12): Promise<LaborPanel> {
  const city6 = cityIbge.replace(/\D/g, "").slice(0, 6);
  const periods = (await prisma.laborStat.findMany({ where: { cityCode: city6 }, distinct: ["period"], select: { period: true }, orderBy: { period: "desc" }, take: months })).map((p) => p.period).sort();
  if (!periods.length) return { available: false, city6, periods: [], monthly: [], bySection: [], highlight: null };
  const rows = await prisma.laborStat.groupBy({ by: ["period", "section"], where: { cityCode: city6, period: { in: periods } }, _sum: { hires: true, separations: true, balance: true } });
  const monthly = periods.map((period) => {
    const r = rows.filter((x) => x.period === period);
    return { period, hires: r.reduce((s, x) => s + (x._sum.hires ?? 0), 0), separations: r.reduce((s, x) => s + (x._sum.separations ?? 0), 0), balance: r.reduce((s, x) => s + (x._sum.balance ?? 0), 0) };
  });
  const sections = new Map<string, { section: string; name: string; hires: number; separations: number; balance: number }>();
  for (const r of rows) {
    const s = sections.get(r.section) ?? { section: r.section, name: SECTION_NAME[r.section] ?? r.section, hires: 0, separations: 0, balance: 0 };
    s.hires += r._sum.hires ?? 0;
    s.separations += r._sum.separations ?? 0;
    s.balance += r._sum.balance ?? 0;
    sections.set(r.section, s);
  }
  const bySection = [...sections.values()].sort((a, b) => b.balance - a.balance);
  return { available: true, city6, periods, monthly, bySection, highlight: highlightSection ? (bySection.find((s) => s.section === highlightSection) ?? null) : null };
}
