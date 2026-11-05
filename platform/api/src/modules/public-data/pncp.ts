import { fold } from "../../lib/normalize.ts";
import { prisma, type Prisma } from "../../lib/prisma.ts";
import type { RadarSettings } from "../orgs/settings.ts";
import { publicMockActive, requestJson, tracked } from "./http.ts";

/**
 * PNCP — API de consulta (pncp.gov.br/api/consulta, swagger conferido em 03/11/2026). Só operações públicas de leitura.
 * O órgão público é o COMPRADOR: uma contratação é oportunidade de venda, não um lead nem um fornecedor.
 */
const BASE = "https://pncp.gov.br/api/consulta";
const PAGE_SIZE = 50;
const MAX_PAGES = 20;
/** contratações simuladas ficam com outra origem: nunca aparecem no radar real */
export const pncpSource = () => (publicMockActive() ? "pncp-mock" : "pncp");

export const PNCP_MODALITIES: Record<number, string> = {
  1: "Leilão eletrônico",
  2: "Diálogo competitivo",
  3: "Concurso",
  4: "Concorrência eletrônica",
  5: "Concorrência presencial",
  6: "Pregão eletrônico",
  7: "Pregão presencial",
  8: "Dispensa de licitação",
  9: "Inexigibilidade",
  10: "Manifestação de interesse",
  11: "Pré-qualificação",
  12: "Credenciamento",
  13: "Leilão presencial",
};

type Compra = {
  numeroControlePNCP: string;
  orgaoEntidade?: { cnpj?: string; razaoSocial?: string };
  unidadeOrgao?: { ufSigla?: string; municipioNome?: string; codigoIbge?: string; nomeUnidade?: string };
  anoCompra?: number;
  sequencialCompra?: number;
  modalidadeId?: number;
  modalidadeNome?: string;
  objetoCompra?: string;
  valorTotalEstimado?: number | null;
  situacaoCompraNome?: string;
  dataPublicacaoPncp?: string;
  dataAberturaProposta?: string;
  dataEncerramentoProposta?: string;
};
type Page = { data?: Compra[]; totalPaginas?: number; paginasRestantes?: number };

const ymd = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");
/** datas do PNCP vêm sem fuso (horário de Brasília) */
const brDate = (s?: string | null) => (s ? new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}-03:00`) : null);

export function toOpportunity(c: Compra): Prisma.PublicOpportunityCreateInput | null {
  if (!c.numeroControlePNCP || !c.objetoCompra) return null;
  const cnpj = c.orgaoEntidade?.cnpj ?? null;
  return {
    source: pncpSource(),
    controlNumber: c.numeroControlePNCP,
    buyerCnpj: cnpj,
    buyerName: c.orgaoEntidade?.razaoSocial ?? null,
    unitName: c.unidadeOrgao?.nomeUnidade ?? null,
    uf: c.unidadeOrgao?.ufSigla ?? null,
    city: c.unidadeOrgao?.municipioNome ?? null,
    cityIbge: c.unidadeOrgao?.codigoIbge ?? null,
    modalityId: c.modalidadeId ?? null,
    modality: c.modalidadeNome ?? (c.modalidadeId ? PNCP_MODALITIES[c.modalidadeId] : null) ?? null,
    object: c.objetoCompra.slice(0, 4000),
    objectFolded: fold(c.objetoCompra).slice(0, 4000),
    estimatedValue: typeof c.valorTotalEstimado === "number" ? c.valorTotalEstimado : null,
    status: c.situacaoCompraNome ?? null,
    publishedAt: brDate(c.dataPublicacaoPncp),
    proposalOpensAt: brDate(c.dataAberturaProposta),
    proposalClosesAt: brDate(c.dataEncerramentoProposta),
    // página pública do edital no PNCP
    url: cnpj && c.anoCompra && c.sequencialCompra ? `https://pncp.gov.br/app/editais/${cnpj}/${c.anoCompra}/${c.sequencialCompra}` : null,
  };
}

async function saveAll(items: Compra[]) {
  let n = 0;
  for (const c of items) {
    const data = toOpportunity(c);
    if (!data) continue;
    await prisma.publicOpportunity.upsert({ where: { source_controlNumber: { source: pncpSource(), controlNumber: data.controlNumber } }, create: data, update: { ...data, fetchedAt: new Date() } });
    n++;
  }
  return n;
}

async function paged(path: string, params: Record<string, string>, ctx: { organizationId: string; maxDaily?: number }) {
  let saved = 0;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const qs = new URLSearchParams({ ...params, pagina: String(page), tamanhoPagina: String(PAGE_SIZE) });
    const res = await requestJson<Page>("pncp", `${BASE}${path}?${qs}`, { ...ctx, timeoutMs: 60_000 });
    if (!res?.data?.length) break;
    saved += await saveAll(res.data);
    if (!res.paginasRestantes || page >= (res.totalPaginas ?? page)) break;
  }
  return saved;
}

/** Sincroniza contratações das UFs/municípios do radar: propostas abertas + publicações recentes das modalidades escolhidas. */
export async function syncRadar(organizationId: string, radar: RadarSettings, o: { maxDaily?: number; now?: Date } = {}) {
  const now = o.now ?? new Date();
  const ctx = { organizationId, maxDaily: o.maxDaily };
  return tracked({ source: "pncp", operation: "sync", organizationId }, async () => {
    let records = 0;
    const places = radar.cityIbgeCodes.length ? radar.cityIbgeCodes.map((c) => ({ uf: null as string | null, city: c as string | null })) : radar.ufs.map((uf) => ({ uf: uf as string | null, city: null as string | null }));
    for (const p of places) {
      const where: Record<string, string> = { ...(p.uf ? { uf: p.uf } : {}), ...(p.city ? { codigoMunicipioIbge: p.city } : {}) };
      records += await paged("/v1/contratacoes/proposta", { ...where, dataFinal: ymd(new Date(now.getTime() + 60 * 86_400_000)) }, ctx);
      for (const m of radar.modalities) {
        records += await paged("/v1/contratacoes/publicacao", { ...where, dataInicial: ymd(new Date(now.getTime() - radar.lookbackDays * 86_400_000)), dataFinal: ymd(now), codigoModalidadeContratacao: String(m) }, ctx);
      }
    }
    return { value: { records, places: places.length }, records };
  });
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Segmentos (e palavras) do radar presentes no objeto da contratação; palavra inteira, sem acento. */
export function classify(objectFolded: string, segments: RadarSettings["segments"]) {
  const out: { id: string; name: string; keywords: string[] }[] = [];
  for (const s of segments.filter((x) => x.enabled)) {
    const hits = s.keywords.filter((k) => new RegExp(`(^|[^a-z0-9])${escapeRe(fold(k))}($|[^a-z0-9])`).test(objectFolded));
    if (hits.length) out.push({ id: s.id, name: s.name, keywords: hits });
  }
  return out;
}

export type RadarFilters = { segment?: string; uf?: string; cityIbge?: string; open?: boolean; days?: number; q?: string; all?: boolean; limit?: number };

/** Oportunidades do catálogo local, classificadas pelos segmentos desta conta. */
export async function listRadar(radar: RadarSettings, f: RadarFilters, now = new Date()) {
  const ufs = f.uf ? [f.uf] : radar.ufs;
  const where: Prisma.PublicOpportunityWhereInput = {
    source: pncpSource(),
    ...(f.cityIbge ? { cityIbge: f.cityIbge } : radar.cityIbgeCodes.length && !f.uf ? { cityIbge: { in: radar.cityIbgeCodes } } : ufs.length ? { uf: { in: ufs } } : {}),
    ...(f.open ? { proposalClosesAt: { gt: now } } : {}),
    ...(f.days ? { publishedAt: { gte: new Date(now.getTime() - f.days * 86_400_000) } } : {}),
    ...(f.q ? { objectFolded: { contains: fold(f.q) } } : {}),
  };
  const rows = await prisma.publicOpportunity.findMany({ where, orderBy: [{ proposalClosesAt: { sort: "asc", nulls: "last" } }, { publishedAt: "desc" }], take: 1000 });
  const items = rows
    .map((r) => ({ ...r, segments: classify(r.objectFolded, radar.segments) }))
    .filter((r) => f.all || r.segments.length)
    .filter((r) => !f.segment || r.segments.some((s) => s.id === f.segment));
  const bySegment = Object.fromEntries(radar.segments.map((s) => [s.id, items.filter((i) => i.segments.some((x) => x.id === s.id)).length]));
  const lastSync = await prisma.integrationRun.findFirst({ where: { source: "pncp", operation: "sync", mock: publicMockActive() }, orderBy: { createdAt: "desc" }, select: { createdAt: true, ok: true, errorCode: true, mock: true } });
  return {
    items: items.slice(0, f.limit ?? 200).map(({ objectFolded: _, ...r }) => r),
    total: items.length,
    bySegment,
    lastSync,
  };
}
