import { fold } from "../../lib/normalize.ts";
import { cachedFetch } from "./cache.ts";
import { requestJson, SourceError, tracked } from "./http.ts";

/**
 * IBGE — API de dados agregados (servicodados.ibge.gov.br, conferida em 03/11/2026). Estatística do MUNICÍPIO:
 * cada valor traz a tabela, a variável e o ano de referência, e nunca é atribuído a uma empresa.
 */
const BASE = "https://servicodados.ibge.gov.br/api";

/** Seções da CNAE 2.0 na classificação 12762 das tabelas do Cadastro Central de Empresas (ids conferidos na tabela 9510). */
export const CNAE_SECTIONS: Record<string, { letter: string; name: string }> = {
  "116830": {
    letter: "A",
    name: "Agricultura, pecuária, produção florestal, pesca e aquicultura",
  },
  "116880": { letter: "B", name: "Indústrias extrativas" },
  "116910": { letter: "C", name: "Indústrias de transformação" },
  "117296": { letter: "D", name: "Eletricidade e gás" },
  "117307": {
    letter: "E",
    name: "Água, esgoto, gestão de resíduos e descontaminação",
  },
  "117329": { letter: "F", name: "Construção" },
  "117363": { letter: "G", name: "Comércio; reparação de veículos" },
  "117484": { letter: "H", name: "Transporte, armazenagem e correio" },
  "117543": { letter: "I", name: "Alojamento e alimentação" },
  "117555": { letter: "J", name: "Informação e comunicação" },
  "117608": { letter: "K", name: "Atividades financeiras e de seguros" },
  "117666": { letter: "L", name: "Atividades imobiliárias" },
  "117673": {
    letter: "M",
    name: "Atividades profissionais, científicas e técnicas",
  },
  "117714": {
    letter: "N",
    name: "Atividades administrativas e serviços complementares",
  },
  "117774": {
    letter: "O",
    name: "Administração pública, defesa e seguridade social",
  },
  "117788": { letter: "P", name: "Educação" },
  "117810": { letter: "Q", name: "Saúde humana e serviços sociais" },
  "117838": { letter: "R", name: "Artes, cultura, esporte e recreação" },
  "117861": { letter: "S", name: "Outras atividades de serviços" },
  "117888": { letter: "T", name: "Serviços domésticos" },
  "117892": { letter: "U", name: "Organismos internacionais" },
};

/** Divisão da CNAE (2 primeiros dígitos) → seção (letra), para destacar o setor da empresa no painel. */
export function sectionOfCnae(cnae: string | null | undefined): string | null {
  const d = Number((cnae ?? "").replace(/\D/g, "").slice(0, 2));
  if (!d) return null;
  const ranges: [number, number, string][] = [
    [1, 3, "A"],
    [5, 9, "B"],
    [10, 33, "C"],
    [35, 35, "D"],
    [36, 39, "E"],
    [41, 43, "F"],
    [45, 47, "G"],
    [49, 53, "H"],
    [55, 56, "I"],
    [58, 63, "J"],
    [64, 66, "K"],
    [68, 68, "L"],
    [69, 75, "M"],
    [77, 82, "N"],
    [84, 84, "O"],
    [85, 85, "P"],
    [86, 88, "Q"],
    [90, 93, "R"],
    [94, 96, "S"],
    [97, 97, "T"],
    [99, 99, "U"],
  ];
  return ranges.find(([a, b]) => d >= a && d <= b)?.[2] ?? null;
}

export type ValueStatus = "ok" | "zero" | "sigilo" | "indisponivel";

/** Convenções do IBGE: "-" zero absoluto · "X" inibido (sigilo) · ".." não se aplica · "..." não disponível. */
export function parseIbgeValue(raw: string | null | undefined): {
  value: number | null;
  status: ValueStatus;
} {
  const v = (raw ?? "").trim();
  if (v === "-") return { value: 0, status: "zero" };
  if (v === "X") return { value: null, status: "sigilo" };
  if (!v || v === ".." || v === "..." || v === "-.")
    return { value: null, status: "indisponivel" };
  const n = Number(v);
  return Number.isFinite(n)
    ? { value: n, status: "ok" }
    : { value: null, status: "indisponivel" };
}

type AgregadoResp = {
  id: string;
  variavel: string;
  unidade: string;
  resultados: {
    classificacoes: { id: string; categoria: Record<string, string> }[];
    series: { serie: Record<string, string> }[];
  }[];
}[];

export type RegionalIndicator = {
  key: string;
  label: string;
  value: number | null;
  status: ValueStatus;
  unit: string;
  referenceYear: string | null;
  table: string;
  note: string;
};
export type SectorRow = {
  section: string;
  name: string;
  localUnits: number | null;
  employed: number | null;
  status: ValueStatus;
};
export type IbgePanel = {
  city: { ibge: string; name: string | null; uf: string | null };
  indicators: RegionalIndicator[];
  sectors: SectorRow[];
  sectorsYear: string | null;
};

type Ctx = { organizationId: string | null; maxDaily?: number };

async function agregado(
  table: string,
  vars: string,
  city: string,
  ctx: Ctx,
  classificacao?: string,
) {
  const qs = new URLSearchParams({ localidades: `N6[${city}]` });
  if (classificacao) qs.set("classificacao", classificacao);
  return (
    (await requestJson<AgregadoResp>(
      "ibge",
      `${BASE}/v3/agregados/${table}/periodos/-1/variaveis/${vars}?${qs}`,
      { ...ctx, timeoutMs: 30_000 },
    )) ?? []
  );
}

const yearOf = (serie: Record<string, string> | undefined) =>
  serie ? (Object.keys(serie).sort().at(-1) ?? null) : null;

/** Município pelo nome e UF (código IBGE de 7 dígitos). */
export async function resolveCity(
  uf: string,
  name: string,
  ctx: Ctx,
): Promise<{ ibge: string; name: string } | null> {
  const list = await cachedFetch("ibge", `municipios:${uf}`, 365, async () => ({
    payload:
      (await requestJson<{ id: number; nome: string }[]>(
        "ibge",
        `${BASE}/v1/localidades/estados/${uf}/municipios`,
        ctx,
      )) ?? [],
  }));
  const target = fold(name);
  const hit = list.payload.find((m) => fold(m.nome) === target);
  return hit ? { ibge: String(hit.id), name: hit.nome } : null;
}

const INDICATORS: {
  key: string;
  table: string;
  variable: string;
  label: string;
  unit: string;
  note: string;
}[] = [
  {
    key: "populacao",
    table: "6579",
    variable: "9324",
    label: "População residente estimada",
    unit: "pessoas",
    note: "Estimativa anual da população (IBGE).",
  },
  {
    key: "pib",
    table: "5938",
    variable: "37",
    label: "PIB a preços correntes",
    unit: "mil R$",
    note: "Produto Interno Bruto dos Municípios (IBGE); publicado com defasagem de cerca de dois anos.",
  },
  {
    key: "unidades_locais",
    table: "9509",
    variable: "706",
    label: "Unidades locais (empresas e outras organizações)",
    unit: "unidades",
    note: "Cadastro Central de Empresas (CEMPRE): estabelecimentos ativos no município, incluindo órgãos públicos e entidades.",
  },
  {
    key: "empresas",
    table: "9509",
    variable: "367",
    label: "Empresas e outras organizações atuantes",
    unit: "unidades",
    note: "CEMPRE: inclui entidades sem fins lucrativos e administração pública.",
  },
  {
    key: "pessoal_ocupado",
    table: "9509",
    variable: "707",
    label: "Pessoal ocupado total",
    unit: "pessoas",
    note: "CEMPRE: pessoas ocupadas nas unidades locais do município.",
  },
  {
    key: "salario_medio",
    table: "9509",
    variable: "1606",
    label: "Salário médio mensal",
    unit: "salários mínimos",
    note: "CEMPRE: média do pessoal assalariado.",
  },
];

/** Painel econômico do município (cache global por município). */
export async function ibgePanel(
  city: { ibge: string; name: string | null; uf: string | null },
  ctx: Ctx & { cacheDays: number; force?: boolean },
) {
  return cachedFetch<IbgePanel>(
    "ibge",
    `painel:${city.ibge}`,
    ctx.cacheDays,
    () =>
      tracked(
        {
          source: "ibge",
          operation: "regional",
          organizationId: ctx.organizationId,
        },
        async () => {
          const [pop, pib, cempre, bySection] = await Promise.all([
            agregado("6579", "9324", city.ibge, ctx),
            agregado("5938", "37", city.ibge, ctx),
            agregado("9509", "706|367|707|1606", city.ibge, ctx),
            agregado(
              "9510",
              "706|707",
              city.ibge,
              ctx,
              `12762[${Object.keys(CNAE_SECTIONS).join(",")}]`,
            ),
          ]);
          const all = [...pop, ...pib, ...cempre];
          if (!all.length)
            throw new SourceError(
              "NOT_FOUND",
              `sem resultados para o município ${city.ibge}`,
            );
          const indicators = INDICATORS.map((d) => {
            const serie = all.find((v) => v.id === d.variable)?.resultados[0]
              ?.series[0]?.serie;
            const year = yearOf(serie);
            const parsed = parseIbgeValue(year ? serie![year] : null);
            return {
              key: d.key,
              label: d.label,
              unit: d.unit,
              note: d.note,
              table: d.table,
              referenceYear: year,
              ...parsed,
            };
          });
          let sectorsYear: string | null = null;
          const sectors = new Map<string, SectorRow>();
          for (const v of bySection) {
            for (const r of v.resultados) {
              const catId = Object.keys(
                r.classificacoes[0]?.categoria ?? {},
              )[0];
              const sec = catId ? CNAE_SECTIONS[catId] : undefined;
              if (!sec) continue;
              const serie = r.series[0]?.serie;
              const year = yearOf(serie);
              sectorsYear ??= year;
              const parsed = parseIbgeValue(year ? serie![year] : null);
              const row = sectors.get(sec.letter) ?? {
                section: sec.letter,
                name: sec.name,
                localUnits: null,
                employed: null,
                status: parsed.status,
              };
              if (v.id === "706") row.localUnits = parsed.value;
              if (v.id === "707") row.employed = parsed.value;
              if (parsed.status !== "ok") row.status = parsed.status;
              else if (
                row.status !== "ok" &&
                (row.localUnits != null || row.employed != null)
              )
                row.status = "ok";
              sectors.set(sec.letter, row);
            }
          }
          const payload: IbgePanel = {
            city,
            indicators,
            sectors: [...sectors.values()].sort((a, b) =>
              a.section.localeCompare(b.section),
            ),
            sectorsYear,
          };
          return {
            value: {
              payload,
              referencePeriod:
                indicators
                  .map((i) => i.referenceYear)
                  .filter(Boolean)
                  .sort()
                  .at(-1) ?? null,
            },
            records: indicators.filter((i) => i.value != null).length,
          };
        },
      ),
    { force: ctx.force },
  );
}
