import { basename } from "node:path";
import { fold } from "../../../lib/normalize.ts";
import { columnSkeleton, runImport, type ImportResult } from "./runner.ts";

/**
 * CVM — dados abertos de companhias abertas (dados.cvm.gov.br): cadastro (cad_cia_aberta.csv, cabeçalho conferido
 * em 03/11/2026) e DFP (dfp_cia_aberta_<BPA|BPP|DRE>_<con|ind>_<ano>.csv, extraídos do .zip anual).
 * Da DFP só ficam as contas principais do exercício mais recente de cada arquivo ("ÚLTIMO").
 */
export const KEY_ACCOUNTS: Record<string, Record<string, string>> = {
  BPA: { "1": "Ativo total" },
  BPP: { "2.01": "Passivo circulante", "2.02": "Passivo não circulante", "2.03": "Patrimônio líquido" },
  DRE: { "3.01": "Receita de venda de bens e/ou serviços", "3.11": "Lucro/prejuízo do período" },
};

const idx = (header: string[] | null, name: string) => {
  const i = (header ?? []).map(columnSkeleton).indexOf(columnSkeleton(name));
  if (i < 0) throw new Error(`Coluna ${name} ausente no arquivo da CVM.`);
  return i;
};
const day = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T12:00:00Z`) : null);

export function dfpFileInfo(file: string) {
  const m = basename(file).match(/dfp_cia_aberta_(BPA|BPP|DRE)_(con|ind)_(\d{4})\.csv$/i);
  return m ? { statement: m[1]!.toUpperCase(), consolidated: m[2]!.toLowerCase() === "con", year: Number(m[3]) } : null;
}

export async function importCvmCadastro(filePath: string, o: { redo?: boolean; signal?: AbortSignal; log?: (m: string) => void } = {}): Promise<ImportResult> {
  return runImport({
    source: "cvm",
    kind: "cvm_cadastro",
    filePath,
    encoding: "latin1",
    delimiter: ";",
    header: true,
    redo: o.redo,
    signal: o.signal,
    log: o.log,
    onBatch: async (rows, header, tx) => {
      const [cnpj, name, trade, reg, sit, code, sector] = ["CNPJ_CIA", "DENOM_SOCIAL", "DENOM_COMERC", "DT_REG", "SIT", "CD_CVM", "SETOR_ATIV"].map((n) => idx(header, n));
      let n = 0;
      for (const r of rows) {
        const d = (r[cnpj!] ?? "").replace(/\D/g, "");
        if (d.length !== 14 || !r[name!]) continue;
        const data = { name: r[name!]!, tradeName: r[trade!] || null, status: r[sit!] || null, cvmCode: r[code!] || null, sector: r[sector!] || null, registeredAt: day(r[reg!]) };
        await tx.cvmCompany.upsert({ where: { cnpj: d }, create: { cnpj: d, ...data }, update: { ...data, importedAt: new Date() } });
        n++;
      }
      return n;
    },
  });
}

export async function importCvmDfp(filePath: string, o: { redo?: boolean; signal?: AbortSignal; log?: (m: string) => void } = {}): Promise<ImportResult> {
  const info = dfpFileInfo(filePath);
  if (!info) throw new Error("Nome de arquivo da DFP não reconhecido (esperado dfp_cia_aberta_<BPA|BPP|DRE>_<con|ind>_<ano>.csv).");
  const accounts = KEY_ACCOUNTS[info.statement]!;
  return runImport({
    source: "cvm",
    kind: "cvm_dfp",
    filePath,
    encoding: "latin1",
    delimiter: ";",
    header: true,
    redo: o.redo,
    signal: o.signal,
    log: o.log,
    onBatch: async (rows, header, tx) => {
      const [cnpj, ref, version, scale, order, account, value] = ["CNPJ_CIA", "DT_REFER", "VERSAO", "ESCALA_MOEDA", "ORDEM_EXERC", "CD_CONTA", "VL_CONTA"].map((n) => idx(header, n));
      let n = 0;
      for (const r of rows) {
        const code = r[account!] ?? "";
        if (!accounts[code] || fold(r[order!] ?? "") !== "ultimo") continue;
        const d = (r[cnpj!] ?? "").replace(/\D/g, "");
        const v = Number(r[value!]);
        const refDate = day(r[ref!]);
        if (d.length !== 14 || !Number.isFinite(v) || !refDate) continue;
        const where = { cnpj_year_statement_consolidated_accountCode: { cnpj: d, year: refDate.getUTCFullYear(), statement: info.statement, consolidated: info.consolidated, accountCode: code } };
        const ver = Number(r[version!]) || 1;
        const current = await tx.cvmFinancial.findUnique({ where, select: { version: true } });
        // reapresentação: só a versão mais nova vale
        if (current && current.version > ver) continue;
        const data = { accountName: accounts[code]!, value: v, scale: (r[scale!] ?? "MIL").toUpperCase(), referenceDate: refDate, version: ver };
        await tx.cvmFinancial.upsert({ where, create: { ...where.cnpj_year_statement_consolidated_accountCode, ...data }, update: data });
        n++;
      }
      return n;
    },
  });
}
