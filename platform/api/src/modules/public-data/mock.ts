import { createHash } from "node:crypto";

/**
 * Fontes públicas SIMULADAS: respondem nos mesmos caminhos e formatos das APIs reais (conferidos em 03/11/2026)
 * com dados sintéticos e determinísticos, sem rede. Usadas em testes e no ambiente isolado; nunca em produção.
 *
 * Cenários especiais:
 * - município 9999999: 503 (fonte indisponível) · 9999998: 429 sempre · 4128203: município sem dados ("...")
 * - Portal da Transparência: chave com "invalida" (ou sem chave) → 401; CNPJ iniciado em 11 → sanção e contratos;
 *   CNPJ iniciado em 22 → só contratos
 * - PageSpeed: chave com "invalida" → 400 "API key not valid"; URL com "falha" → 500; "lento" → notas baixas;
 *   "semtrafego" → sem dados de usuários reais (CrUX)
 */

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const h = (seed: string) => Number.parseInt(createHash("sha256").update(seed).digest("hex").slice(0, 8), 16);

const CITIES: Record<string, { id: number; nome: string }[]> = {
  PR: [
    { id: 4128104, nome: "Umuarama" },
    { id: 4106902, nome: "Curitiba" },
    { id: 4115200, nome: "Maringá" },
    { id: 4128203, nome: "Município Sem Dados" },
  ],
  SP: [{ id: 3550308, nome: "São Paulo" }],
};

const SECTION_IDS = ["116830", "116880", "116910", "117296", "117307", "117329", "117363", "117484", "117543", "117555", "117666", "117673", "117714", "117788", "117810", "117861"];

function special(city: string | null): Response | null {
  if (city === "9999999") return json(503, { message: "Serviço temporariamente indisponível (simulado)" });
  if (city === "9999998") return json(429, { message: "Too Many Requests (simulado)" });
  return null;
}

function ibge(url: URL): Response {
  const mun = url.pathname.match(/\/localidades\/estados\/([A-Z]{2})\/municipios/);
  if (mun) return json(200, (CITIES[mun[1]!] ?? []).map((c) => ({ ...c, microrregiao: { mesorregiao: { UF: { sigla: mun[1] } } } })));
  const ag = url.pathname.match(/\/agregados\/(\d+)\/periodos\/-1\/variaveis\/([\d|]+)/);
  if (!ag) return json(404, { message: "não encontrado" });
  const city = url.searchParams.get("localidades")?.match(/N6\[(\d{7})\]/)?.[1] ?? null;
  const sp = special(city);
  if (sp) return sp;
  const table = ag[1]!;
  const vars = ag[2]!.split("|");
  const year = table === "6579" ? "2025" : table === "5938" ? "2023" : "2024";
  const empty = city === "4128203";
  const value = (v: string, extra = "") => (empty ? "..." : String((h(`${city}:${table}:${v}:${extra}`) % 9000) + (v === "9324" ? 20_000 : v === "37" ? 1_000_000 : 50)));
  const sections = url.searchParams.get("classificacao")?.match(/12762\[([\d,]+)\]/)?.[1]?.split(",") ?? null;
  return json(
    200,
    vars.map((v) => ({
      id: v,
      variavel: `Variável ${v} (simulada)`,
      unidade: v === "37" ? "Mil Reais" : v === "1606" ? "Salários mínimos" : "Unidades",
      resultados: (sections ?? [null]).map((s) => ({
        classificacoes: s ? [{ id: "12762", nome: "CNAE 2.0", categoria: { [s]: `${String.fromCharCode(65 + SECTION_IDS.indexOf(s))} Seção simulada` } }] : [],
        series: [{ localidade: { id: city, nivel: { id: "N6", nome: "Município" }, nome: "Município simulado" }, serie: { [year]: s && h(s) % 7 === 0 ? "-" : value(v, s ?? "") } }],
      })),
    })),
  );
}

function comex(url: URL, body: { flow?: string; monthDetail?: boolean; period?: { from: string; to: string }; filters?: { filter: string; values: (string | number)[] }[]; details?: string[] }): Response {
  if (url.pathname === "/general/dates/updated") return json(200, { data: { updated: "2026-10-06", year: "2026", monthNumber: "09" }, success: true });
  if (url.pathname !== "/cities") return json(404, { message: "não encontrado" });
  const city = String(body.filters?.find((f) => f.filter === "city")?.values?.[0] ?? "");
  const sp = special(city);
  if (sp) return sp;
  if (city === "4128203") return json(200, { data: { list: [] }, success: true });
  const from = Number(body.period?.from?.slice(0, 4) ?? 2025);
  const to = Number(body.period?.to?.slice(0, 4) ?? from);
  const detail = body.details?.[0];
  const items = detail === "heading" ? [["0207", "Carnes e miudezas de aves (simulado)"], ["9404", "Colchões e artigos de cama (simulado)"], ["4104", "Couros curtidos (simulado)"]] : detail === "country" ? [["CN", "China"], ["PY", "Paraguai"], ["US", "Estados Unidos"]] : [["", ""]];
  const lastMonth = Number(body.period?.to?.slice(5, 7) ?? 12);
  const list = [];
  for (let y = from; y <= to; y++)
    for (const m of body.monthDetail ? Array.from({ length: y === to ? lastMonth : 12 }, (_, i) => i + 1) : [null])
      for (const [code, name] of items) {
        const fob = h(`${city}:${body.flow}:${y}:${m}:${code}`) % 500_000;
        list.push({ year: String(y), ...(m ? { monthNumber: String(m).padStart(2, "0") } : {}), ...(detail === "heading" ? { headingCode: code, heading: name } : detail === "country" ? { country: name } : {}), metricFOB: String(fob), metricKG: String(Math.round(fob * 0.6)) });
      }
  return json(200, { data: { list }, success: true });
}

const PNCP_OBJECTS = [
  "Contratação de agência de publicidade para campanhas institucionais e gestão de redes sociais (simulado)",
  "Desenvolvimento e hospedagem de site institucional e portal da transparência do município (simulado)",
  "Aquisição de computadores, notebooks e impressoras para as secretarias (simulado)",
  "Licença de uso de software de gestão de atendimento ao cidadão (simulado)",
  "Manutenção preventiva e corretiva de aparelhos de ar-condicionado (simulado)",
  "Serviços de limpeza urbana e coleta de resíduos (simulado)",
  "Consultoria e treinamento em gestão pública (simulado)",
];

function pncp(url: URL): Response {
  const city = url.searchParams.get("codigoMunicipioIbge");
  const sp = special(city);
  if (sp) return sp;
  const uf = url.searchParams.get("uf") ?? "PR";
  if (!/\/v1\/contratacoes\/(proposta|publicacao)$/.test(url.pathname)) return json(404, { message: "não encontrado" });
  if (url.pathname.endsWith("publicacao") && (!url.searchParams.get("dataInicial") || !url.searchParams.get("codigoModalidadeContratacao"))) return json(400, { message: "parâmetros obrigatórios ausentes" });
  const modality = Number(url.searchParams.get("codigoModalidadeContratacao") ?? 6);
  // publicação: só o pregão eletrônico (6) tem itens no simulado, para não repetir as mesmas contratações
  if (url.pathname.endsWith("publicacao") && modality !== 6) return new Response(null, { status: 204 });
  const page = Number(url.searchParams.get("pagina") ?? 1);
  const size = Number(url.searchParams.get("tamanhoPagina") ?? 50);
  const all = PNCP_OBJECTS.map((obj, i) => {
    const seq = i + 1;
    return {
      numeroControlePNCP: `76247378000156-1-${String(seq).padStart(6, "0")}/2026`,
      orgaoEntidade: { cnpj: "76247378000156", razaoSocial: `MUNICIPIO SIMULADO ${uf}`, poderId: "N", esferaId: "M" },
      unidadeOrgao: { ufSigla: uf, municipioNome: "Umuarama", codigoIbge: city ?? "4128104", nomeUnidade: "Unidade administrativa (simulada)" },
      anoCompra: 2026,
      sequencialCompra: seq,
      modalidadeId: 6,
      modalidadeNome: "Pregão - Eletrônico",
      objetoCompra: obj,
      valorTotalEstimado: i === 3 ? null : (i + 1) * 45_000,
      situacaoCompraNome: "Divulgada no PNCP",
      dataPublicacaoPncp: `2026-10-${String(20 + i).padStart(2, "0")}T10:00:00`,
      dataAberturaProposta: `2026-10-${String(20 + i).padStart(2, "0")}T08:00:00`,
      dataEncerramentoProposta: `2026-11-${String(10 + i).padStart(2, "0")}T08:00:00`,
    };
  });
  const data = all.slice((page - 1) * size, page * size);
  if (!data.length) return new Response(null, { status: 204 });
  const totalPaginas = Math.ceil(all.length / size);
  return json(200, { data, totalRegistros: all.length, totalPaginas, numeroPagina: page, paginasRestantes: totalPaginas - page, empty: false });
}

function transparencia(url: URL, headers: Headers): Response {
  const key = headers.get("chave-api-dados") ?? "";
  if (!key || key.toLowerCase().includes("invalida")) return json(401, { message: "Chave de API inválida (simulado)" });
  const page = Number(url.searchParams.get("pagina") ?? 1);
  const cnpj = (url.searchParams.get("codigoSancionado") ?? url.searchParams.get("cpfCnpj") ?? "").replace(/\D/g, "");
  if (page > 1) return json(200, []);
  if (url.pathname.endsWith("/ceis")) {
    if (!cnpj.startsWith("11")) return json(200, []);
    return json(200, [
      {
        id: 900001,
        dataInicioSancao: "15/03/2021",
        dataFimSancao: "15/03/2023",
        dataPublicacaoSancao: "16/03/2021",
        tipoSancao: { descricaoResumida: "Impedimento de licitar e contratar (simulado)" },
        orgaoSancionador: { nome: "Prefeitura Simulada", siglaUf: "PR", esfera: "Municipal" },
        sancionado: { nome: "EMPRESA SIMULADA LTDA", codigoFormatado: cnpj },
        fonteSancao: { nomeExibicao: "Prefeitura Simulada" },
        linkPublicacao: "https://portaldatransparencia.gov.br/sancoes/ceis/900001",
        numeroProcesso: "123/2021",
      },
    ]);
  }
  if (url.pathname.endsWith("/cnep")) return json(200, []);
  if (url.pathname.endsWith("/contratos/cpf-cnpj")) {
    if (!cnpj.startsWith("11") && !cnpj.startsWith("22")) return json(200, []);
    return json(200, [1, 2].map((n) => ({
      id: 700000 + n,
      numero: `0000${n}/2025`,
      objeto: `Prestação de serviços de suporte técnico ${n} (simulado)`,
      situacaoContrato: n === 1 ? "Ativo" : "Encerrado",
      modalidadeCompra: "Pregão",
      unidadeGestora: { nome: "Órgão Federal Simulado", orgaoMaximo: { nome: "Ministério Simulado" } },
      dataAssinatura: `10/0${n}/2025`,
      dataInicioVigencia: `10/0${n}/2025`,
      dataFimVigencia: `10/0${n}/2026`,
      valorFinalCompra: 120_000 * n,
      fornecedor: { cnpjFormatado: cnpj, nome: "EMPRESA SIMULADA LTDA" },
    })));
  }
  return json(404, { message: "não encontrado" });
}

function pagespeed(url: URL): Response {
  const key = url.searchParams.get("key") ?? "";
  if (key.toLowerCase().includes("invalida")) return json(400, { error: { code: 400, message: "API key not valid. Please pass a valid API key. (simulado)" } });
  const target = url.searchParams.get("url") ?? "";
  if (target.includes("falha")) return json(500, { error: { code: 500, message: "Lighthouse returned error: FAILED_DOCUMENT_REQUEST (simulado)" } });
  const strategy = url.searchParams.get("strategy") ?? "mobile";
  const slow = target.includes("lento");
  const base = (h(`${target}:${strategy}`) % 30) / 100;
  const perf = slow ? 0.21 : Math.min(0.99, (strategy === "desktop" ? 0.65 : 0.5) + base);
  const audit = (v: number) => ({ numericValue: v });
  const metric = (percentile: number, category: string) => ({ percentile, category });
  return json(200, {
    id: target,
    lighthouseResult: {
      lighthouseVersion: "12.0.0 (simulado)",
      finalDisplayedUrl: target,
      categories: { performance: { score: perf }, seo: { score: 0.82 }, accessibility: { score: 0.77 }, "best-practices": { score: 0.9 } },
      audits: {
        "largest-contentful-paint": audit(slow ? 7200 : 2400),
        "cumulative-layout-shift": audit(slow ? 0.31 : 0.04),
        "total-blocking-time": audit(slow ? 1400 : 180),
        "first-contentful-paint": audit(slow ? 3900 : 1200),
      },
    },
    ...(target.includes("semtrafego")
      ? {}
      : {
          loadingExperience: {
            overall_category: slow ? "SLOW" : "AVERAGE",
            metrics: {
              INTERACTION_TO_NEXT_PAINT: metric(slow ? 620 : 210, slow ? "SLOW" : "AVERAGE"),
              LARGEST_CONTENTFUL_PAINT_MS: metric(slow ? 6100 : 2600, slow ? "SLOW" : "AVERAGE"),
              CUMULATIVE_LAYOUT_SHIFT_SCORE: metric(slow ? 28 : 5, slow ? "SLOW" : "FAST"),
            },
          },
        }),
  });
}

/** `fetch` que responde como as fontes públicas, sem rede. */
export function createPublicDataMock(): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    const headers = new Headers(init?.headers);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    switch (url.hostname) {
      case "servicodados.ibge.gov.br":
        return ibge(url);
      case "api-comexstat.mdic.gov.br":
        return comex(url, body);
      case "pncp.gov.br":
        return pncp(url);
      case "api.portaldatransparencia.gov.br":
        return transparencia(url, headers);
      case "www.googleapis.com":
        return pagespeed(url);
      default:
        return json(404, { message: `host fora do simulado: ${url.hostname}` });
    }
  }) as typeof fetch;
}
