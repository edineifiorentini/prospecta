import { prisma } from "../../lib/prisma.ts";
import { cnpjDigits, isValidCnpj } from "../company-data/cnpj.ts";
import { sourceKey } from "./credentials.ts";
import { assertEnabled, publicMockActive, requestJson, SourceError, tracked } from "./http.ts";

/**
 * Portal da Transparência (CGU) — API de dados (swagger v3 conferido em 03/11/2026). Exige token gratuito no
 * cabeçalho `chave-api-dados`. Registros ligados SOMENTE pelo CNPJ exato. Informativo: um registro de sanção
 * não prova irregularidade atual (confira vigência, órgão e contexto) e não bloqueia nada no Prospecta.
 */
const BASE = "https://api.portaldatransparencia.gov.br/api-de-dados";
const MAX_PAGES = 5;
const SOURCE = "transparencia";

type Sancao = {
  id: number;
  dataInicioSancao?: string;
  dataFimSancao?: string;
  dataPublicacaoSancao?: string;
  tipoSancao?: { descricaoResumida?: string; descricaoPortal?: string };
  orgaoSancionador?: { nome?: string; siglaUf?: string; esfera?: string };
  sancionado?: { nome?: string; codigoFormatado?: string };
  pessoa?: { cnpjFormatado?: string };
  linkPublicacao?: string;
  numeroProcesso?: string;
  valorMulta?: string;
};
type Contrato = {
  id: number;
  numero?: string;
  objeto?: string;
  situacaoContrato?: string;
  modalidadeCompra?: string;
  unidadeGestora?: { nome?: string; orgaoMaximo?: { nome?: string } };
  dataAssinatura?: string;
  dataInicioVigencia?: string;
  dataFimVigencia?: string;
  valorFinalCompra?: number;
  fornecedor?: { cnpjFormatado?: string };
};

/** "15/03/2021" → Date (meio-dia UTC, para não trocar de dia por fuso) */
export function brDay(s?: string | null): Date | null {
  const m = s?.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]), 12)) : null;
}
const money = (v?: string | number | null) => (typeof v === "number" ? v : v ? Number(String(v).replace(/\./g, "").replace(",", ".")) || null : null);

export type PublicRecordInput = {
  kind: "CEIS" | "CNEP" | "CONTRATO_FEDERAL";
  externalId: string;
  agency: string | null;
  recordType: string | null;
  description: string | null;
  status: string | null;
  startDate: Date | null;
  endDate: Date | null;
  value: number | null;
  url: string | null;
};

export function sanctionStatus(end: Date | null, now = new Date()) {
  return !end ? "sem data de término informada" : end.getTime() >= now.getTime() ? "vigente" : "prazo encerrado";
}

export function fromSancao(kind: "CEIS" | "CNEP", s: Sancao, now = new Date()): PublicRecordInput {
  const end = brDay(s.dataFimSancao);
  const org = s.orgaoSancionador;
  return {
    kind,
    externalId: String(s.id),
    agency: org?.nome ? `${org.nome}${org.siglaUf ? ` (${org.siglaUf})` : ""}` : null,
    recordType: s.tipoSancao?.descricaoResumida ?? s.tipoSancao?.descricaoPortal ?? null,
    description: s.numeroProcesso ? `Processo ${s.numeroProcesso}` : null,
    status: sanctionStatus(end, now),
    startDate: brDay(s.dataInicioSancao),
    endDate: end,
    value: kind === "CNEP" ? money(s.valorMulta) : null,
    url: s.linkPublicacao?.startsWith("http") ? s.linkPublicacao : null,
  };
}

export function fromContrato(c: Contrato): PublicRecordInput {
  return {
    kind: "CONTRATO_FEDERAL",
    externalId: String(c.id),
    agency: c.unidadeGestora?.orgaoMaximo?.nome ?? c.unidadeGestora?.nome ?? null,
    recordType: c.modalidadeCompra ?? null,
    description: c.objeto ? `${c.numero ? `Contrato ${c.numero}: ` : ""}${c.objeto}`.slice(0, 1000) : null,
    status: c.situacaoContrato ?? null,
    startDate: brDay(c.dataInicioVigencia ?? c.dataAssinatura),
    endDate: brDay(c.dataFimVigencia),
    value: money(c.valorFinalCompra),
    url: null,
  };
}

async function pages<T>(path: string, params: Record<string, string>, ctx: { organizationId: string; maxDaily: number; headers: Record<string, string> }) {
  const out: T[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await requestJson<T[]>(SOURCE, `${BASE}${path}?${new URLSearchParams({ ...params, pagina: String(page) })}`, ctx);
    if (!res?.length) break;
    out.push(...res);
    if (res.length < 15) break;
  }
  return out;
}

export async function publicRecords(organizationId: string, companyId: string) {
  const [records, lastRun] = await Promise.all([
    prisma.companyPublicRecord.findMany({ where: { organizationId, companyId, source: { in: [SOURCE, `${SOURCE}-mock`] } }, orderBy: [{ kind: "asc" }, { startDate: "desc" }] }),
    prisma.integrationRun.findFirst({ where: { organizationId, companyId, source: SOURCE, operation: "company" }, orderBy: { createdAt: "desc" }, select: { createdAt: true, ok: true, errorCode: true, mock: true } }),
  ]);
  const mock = publicMockActive();
  return { records: records.filter((r) => r.source === (mock ? `${SOURCE}-mock` : SOURCE)), lastRun };
}

/** Consulta CEIS, CNEP e contratos federais pelo CNPJ validado da empresa (com cache por empresa). */
export async function checkCompanyRecords(organizationId: string, companyId: string, o: { force?: boolean } = {}) {
  const cfg = await assertEnabled(organizationId, SOURCE);
  const company = await prisma.company.findFirst({ where: { id: companyId, organizationId }, select: { cnpj: true } });
  if (!company) throw new SourceError("NOT_FOUND", "empresa não encontrada");
  const cnpj = cnpjDigits(company.cnpj);
  if (!cnpj || !isValidCnpj(cnpj)) throw new SourceError("INVALID_REQUEST", "A empresa não tem CNPJ validado: sem ele, nenhum registro público é vinculado.");
  const mock = publicMockActive();
  const recent = await prisma.integrationRun.findFirst({ where: { organizationId, companyId, source: SOURCE, operation: "company", ok: true, mock }, orderBy: { createdAt: "desc" } });
  if (!o.force && recent && Date.now() - recent.createdAt.getTime() < cfg.cacheDays * 86_400_000) return { ...(await publicRecords(organizationId, companyId)), cached: true };

  const key = await sourceKey(organizationId, SOURCE);
  if (!key && !mock) throw new SourceError("NOT_CONFIGURED");
  const ctx = { organizationId, maxDaily: cfg.maxDailyRequests, headers: { "chave-api-dados": key || "chave-simulada" } };
  const now = new Date();
  await tracked({ source: SOURCE, operation: "company", organizationId, companyId }, async () => {
    const [ceis, cnep, contratos] = [
      await pages<Sancao>("/ceis", { codigoSancionado: cnpj }, ctx),
      await pages<Sancao>("/cnep", { codigoSancionado: cnpj }, ctx),
      await pages<Contrato>("/contratos/cpf-cnpj", { cpfCnpj: cnpj }, ctx),
    ];
    // só o CNPJ exato: nada de semelhança de nome
    const same = (v?: string) => cnpjDigits(v ?? "") === cnpj;
    const rows: PublicRecordInput[] = [
      ...ceis.filter((s) => same(s.sancionado?.codigoFormatado) || same(s.pessoa?.cnpjFormatado)).map((s) => fromSancao("CEIS", s, now)),
      ...cnep.filter((s) => same(s.sancionado?.codigoFormatado) || same(s.pessoa?.cnpjFormatado)).map((s) => fromSancao("CNEP", s, now)),
      ...contratos.filter((c) => same(c.fornecedor?.cnpjFormatado)).map(fromContrato),
    ];
    const source = mock ? `${SOURCE}-mock` : SOURCE;
    await prisma.$transaction([
      prisma.companyPublicRecord.deleteMany({ where: { organizationId, companyId, source } }),
      prisma.companyPublicRecord.createMany({ data: rows.map((r) => ({ ...r, organizationId, companyId, source, cnpj, fetchedAt: now })), skipDuplicates: true }),
    ]);
    return { value: null, records: rows.length };
  });
  return { ...(await publicRecords(organizationId, companyId)), cached: false };
}
