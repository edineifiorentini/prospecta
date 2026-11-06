import { Prisma } from "../../../lib/prisma.ts";
import { fold, hostOf, isGenericDomain } from "../../../lib/normalize.ts";
import { runImport, type ImportResult } from "./runner.ts";

/**
 * Receita Federal — dados abertos do CNPJ (arquivos CSV sem cabeçalho, separador ";", aspas, Latin-1).
 * Layout: "Metadados" publicados com os arquivos (Empresas, Estabelecimentos, Sócios e tabelas de código).
 *
 * Minimização (LGPD): de Sócios só a quantidade por empresa; de Estabelecimentos o e-mail vira só o domínio
 * (para cruzar com o site). Endereço e telefone ficam, porque identificam o estabelecimento, não uma pessoa.
 */
export const RECEITA_KINDS = ["estabelecimentos", "empresas", "socios", "cnaes", "naturezas", "municipios", "motivos"] as const;
export type ReceitaKind = (typeof RECEITA_KINDS)[number];

const day = (v: string) => (/^\d{8}$/.test(v) && v !== "00000000" ? new Date(`${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}T12:00:00Z`) : null);
const blank = (v: string | undefined) => (v && v.trim() ? v.trim() : null);
const phone = (ddd: string | undefined, num: string | undefined) => {
  const d = `${ddd ?? ""}${num ?? ""}`.replace(/\D/g, "");
  return d.length >= 10 && d.length <= 11 ? d : null;
};
const money = (v: string | undefined) => (v ? Number(v.replace(/\./g, "").replace(",", ".")) || null : null);

export type ReceitaFilters = { uf?: string; municipio?: string };

/** provedores de e-mail gratuitos: o domínio não identifica a empresa (nem a de quem preencheu o cadastro) */
const EMAIL_PROVIDERS = /^(gmail|googlemail|hotmail|outlook|live|msn|yahoo|ymail|icloud|me|uol|bol|terra|ig|globo|globomail|r7|zipmail|protonmail|proton|aol|gmx)\./;

export function toEstabelecimento(c: string[], f: ReceitaFilters) {
  if (c.length < 28) return null;
  const uf = blank(c[19]);
  const mun = blank(c[20]);
  if (f.uf && uf !== f.uf) return null;
  if (f.municipio && mun !== f.municipio) return null;
  const cnpj = `${c[0]}${c[1]}${c[2]}`.replace(/\D/g, "");
  if (cnpj.length !== 14) return null;
  const nome = blank(c[4]);
  const host = hostOf(`http://${(c[27] ?? "").split("@")[1] ?? ""}`);
  return {
    cnpj,
    cnpjBasico: cnpj.slice(0, 8),
    matrizFilial: blank(c[3]),
    nomeFantasia: nome,
    nomeFolded: nome ? fold(nome) : null,
    situacao: blank(c[5]),
    dataSituacao: day(c[6] ?? ""),
    motivoSituacao: blank(c[7]),
    dataInicio: day(c[10] ?? ""),
    cnaePrincipal: blank(c[11]),
    cnaesSecundarios: (c[12] ?? "").split(",").map((x) => x.trim()).filter(Boolean),
    logradouro: [blank(c[13]), blank(c[14])].filter(Boolean).join(" ") || null,
    numero: blank(c[15]),
    complemento: blank(c[16]),
    bairro: blank(c[17]),
    cep: blank(c[18])?.replace(/\D/g, "") ?? null,
    uf,
    municipioCodigo: mun,
    telefones: [phone(c[21], c[22]), phone(c[23], c[24])].filter((x): x is string => !!x),
    emailDominio: host && !isGenericDomain(host) && !EMAIL_PROVIDERS.test(host) ? host : null,
  };
}

/** raízes (8 dígitos) já presentes no recorte de estabelecimentos: empresas e sócios só entram se existirem */
async function knownRoots(tx: Prisma.TransactionClient, roots: string[]) {
  if (!roots.length) return new Set<string>();
  const rows = await tx.rfEstabelecimento.findMany({ where: { cnpjBasico: { in: [...new Set(roots)] } }, select: { cnpjBasico: true }, distinct: ["cnpjBasico"] });
  return new Set(rows.map((r) => r.cnpjBasico));
}

export async function importReceita(kind: ReceitaKind, filePath: string, o: { filters?: ReceitaFilters; redo?: boolean; signal?: AbortSignal; batchSize?: number; log?: (m: string) => void } = {}): Promise<ImportResult> {
  const filters = o.filters ?? {};
  const base = { source: "receita_aberta", kind, filePath, encoding: "latin1" as const, delimiter: ";", header: false, filters, redo: o.redo, signal: o.signal, batchSize: o.batchSize, log: o.log };
  if (kind === "estabelecimentos")
    return runImport({
      ...base,
      onBatch: async (rows, _h, tx) => {
        const data = rows.map((r) => toEstabelecimento(r, filters)).filter((x): x is NonNullable<typeof x> => !!x);
        for (const d of data) await tx.rfEstabelecimento.upsert({ where: { cnpj: d.cnpj }, create: d, update: { ...d, importedAt: new Date() } });
        return data.length;
      },
    });
  if (kind === "empresas")
    return runImport({
      ...base,
      onBatch: async (rows, _h, tx) => {
        const known = await knownRoots(tx, rows.map((r) => r[0] ?? ""));
        const data = rows
          .filter((r) => known.has(r[0] ?? ""))
          .map((r) => ({ cnpjBasico: r[0]!, razaoSocial: r[1] ?? "", naturezaJuridica: blank(r[2]), capitalSocial: money(r[4]), porte: blank(r[5]) }));
        for (const d of data) await tx.rfEmpresa.upsert({ where: { cnpjBasico: d.cnpjBasico }, create: d, update: { ...d, importedAt: new Date() } });
        return data.length;
      },
    });
  if (kind === "socios")
    return runImport({
      ...base,
      // contagem somada lote a lote e entre os arquivos Socios0…9 (o checkpoint vai na mesma transação, então a
      // retomada não conta duas vezes); refazer um arquivo só somaria de novo: use --limpar-socios e importe todos
      onRedo: async () => {
        throw new Error("Sócios não pode ser refeito arquivo a arquivo: use --limpar-socios e importe todos os arquivos de novo.");
      },
      onBatch: async (rows, _h, tx) => {
        const known = await knownRoots(tx, rows.map((r) => r[0] ?? ""));
        const counts = new Map<string, number>();
        for (const r of rows) if (known.has(r[0] ?? "")) counts.set(r[0]!, (counts.get(r[0]!) ?? 0) + 1);
        if (!counts.size) return 0;
        await tx.$executeRaw`INSERT INTO rf_socios_resumo (cnpj_basico, quantidade) VALUES ${Prisma.join([...counts].map(([k, n]) => Prisma.sql`(${k}, ${n})`))}
          ON CONFLICT (cnpj_basico) DO UPDATE SET quantidade = rf_socios_resumo.quantidade + EXCLUDED.quantidade`;
        return [...counts.values()].reduce((a, b) => a + b, 0);
      },
    });
  const tipo = { cnaes: "cnae", naturezas: "natureza", municipios: "municipio", motivos: "motivo" }[kind];
  return runImport({
    ...base,
    onBatch: async (rows, _h, tx) => {
      const data = rows.filter((r) => r[0] && r[1]).map((r) => ({ tipo, codigo: r[0]!, descricao: r[1]! }));
      for (const d of data) await tx.rfCodigo.upsert({ where: { tipo_codigo: { tipo: d.tipo, codigo: d.codigo } }, create: d, update: { descricao: d.descricao } });
      return data.length;
    },
  });
}
