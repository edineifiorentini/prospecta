import { prisma } from "../../lib/prisma.ts";
import { cnpjDigits } from "../company-data/cnpj.ts";

/**
 * Demonstrações financeiras de companhias abertas (CVM, importadas). Só existem quando o CNPJ validado da empresa
 * é exatamente o de uma companhia registrada na CVM; empresas fechadas não têm esse dado (e isso não é negativo).
 */
export type CvmPanel = {
  company: { cnpj: string; name: string; tradeName: string | null; status: string | null; sector: string | null; cvmCode: string | null };
  years: { year: number; consolidated: boolean; referenceDate: string; items: { statement: string; accountCode: string; accountName: string; valueBrl: number }[] }[];
};

export async function cvmPanel(cnpjRaw: string | null): Promise<CvmPanel | null> {
  const cnpj = cnpjDigits(cnpjRaw);
  if (cnpj.length !== 14) return null;
  const company = await prisma.cvmCompany.findUnique({ where: { cnpj } });
  if (!company) return null;
  const rows = await prisma.cvmFinancial.findMany({ where: { cnpj }, orderBy: [{ year: "desc" }, { statement: "asc" }, { accountCode: "asc" }] });
  const years = [...new Set(rows.map((r) => r.year))].slice(0, 3).map((year) => {
    const ofYear = rows.filter((r) => r.year === year);
    // consolidado quando houver; senão o individual
    const consolidated = ofYear.some((r) => r.consolidated);
    const chosen = ofYear.filter((r) => r.consolidated === consolidated);
    return {
      year,
      consolidated,
      referenceDate: chosen[0]!.referenceDate.toISOString().slice(0, 10),
      items: chosen.map((r) => ({ statement: r.statement, accountCode: r.accountCode, accountName: r.accountName, valueBrl: r.scale === "MIL" ? r.value * 1000 : r.value })),
    };
  });
  return { company: { cnpj, name: company.name, tradeName: company.tradeName, status: company.status, sector: company.sector, cvmCode: company.cvmCode }, years };
}
