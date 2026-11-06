import { writeAudit } from "../../lib/audit-log.ts";
import { fold, isGenericDomain, normDomain, normalizePhone } from "../../lib/normalize.ts";
import { prisma, type Prisma } from "../../lib/prisma.ts";
import { nameSimilarity } from "../companies/dedupe.ts";
import { cnpjDigits, isValidCnpj } from "../company-data/cnpj.ts";
import { profileDto } from "../company-data/service.ts";
import type { BusinessProfile, DataPoint, MatchCandidate } from "../company-data/types.ts";
import { assertEnabled, SourceError, tracked } from "./http.ts";
import { RECEITA_PROVIDER } from "./sources.ts";

export { RECEITA_PROVIDER };

/**
 * Receita Federal — leitura do recorte local dos dados abertos do CNPJ (importado por linha de comando).
 * Identificação: CNPJ válido → direto; senão telefone (DDD + número) ou domínio do e-mail iguais aos da empresa,
 * na mesma UF/cidade. Semelhança de nome sozinha só gera candidatos para uma pessoa confirmar.
 */
const SOURCE = "Receita Federal · dados abertos (base local)";
const SITUACAO: Record<string, string> = { "01": "NULA", "02": "ATIVA", "03": "SUSPENSA", "04": "INAPTA", "08": "BAIXADA" };
const PORTE: Record<string, string> = { "01": "ME", "03": "EPP", "05": "Demais" };
const MIN_NAME_SIMILARITY = 0.5;

const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
export const formatCnae = (c: string | null | undefined) => {
  const d = (c ?? "").replace(/\D/g, "");
  return d.length === 7 ? `${d.slice(0, 4)}-${d.slice(4, 5)}/${d.slice(5)}` : d || null;
};

type Codes = Map<string, string>;
async function codes(tipo: string, values: (string | null | undefined)[]): Promise<Codes> {
  const list = [...new Set(values.filter((v): v is string => !!v))];
  if (!list.length) return new Map();
  const rows = await prisma.rfCodigo.findMany({ where: { tipo, codigo: { in: list } } });
  return new Map(rows.map((r) => [r.codigo, r.descricao]));
}

/** Perfil normalizado (mesmo modelo dos dados empresariais) a partir da base local. */
export async function receitaProfile(cnpjRaw: string): Promise<BusinessProfile | null> {
  const cnpj = cnpjDigits(cnpjRaw);
  const e = await prisma.rfEstabelecimento.findUnique({ where: { cnpj } });
  if (!e) return null;
  const [empresa, socios, branches] = await Promise.all([
    prisma.rfEmpresa.findUnique({ where: { cnpjBasico: e.cnpjBasico } }),
    prisma.rfSociosResumo.findUnique({ where: { cnpjBasico: e.cnpjBasico } }),
    prisma.rfEstabelecimento.findMany({ where: { cnpjBasico: e.cnpjBasico, cnpj: { not: cnpj } }, take: 20, orderBy: { cnpj: "asc" } }),
  ]);
  const [cnaes, naturezas, municipios] = await Promise.all([
    codes("cnae", [e.cnaePrincipal, ...e.cnaesSecundarios]),
    codes("natureza", [empresa?.naturezaJuridica]),
    codes("municipio", [e.municipioCodigo, ...branches.map((b) => b.municipioCodigo)]),
  ]);
  const at = e.importedAt.toISOString();
  const dp = <T>(value: T, note?: string): DataPoint<T> => ({ value, nature: "OFFICIAL", source: SOURCE, fetchedAt: at, note: note ?? null });
  const p: BusinessProfile = { provider: RECEITA_PROVIDER, simulated: false, fetchedAt: at, cnpj, buckets: ["cadastro"] };
  if (empresa?.razaoSocial) p.legalName = dp(empresa.razaoSocial);
  if (e.nomeFantasia) p.tradeName = dp(e.nomeFantasia);
  if (e.matrizFilial) p.unitType = dp(e.matrizFilial === "1" ? "MATRIZ" : "FILIAL");
  if (e.situacao && SITUACAO[e.situacao]) p.registrationStatus = dp(SITUACAO[e.situacao]!);
  if (e.dataSituacao) p.registrationStatusDate = dp(iso(e.dataSituacao)!);
  if (e.dataInicio) p.openedAt = dp(iso(e.dataInicio)!);
  if (empresa?.naturezaJuridica) p.legalNature = dp(`${empresa.naturezaJuridica} ${naturezas.get(empresa.naturezaJuridica) ?? ""}`.trim());
  if (e.cnaePrincipal) p.primaryCnae = dp({ code: formatCnae(e.cnaePrincipal), description: cnaes.get(e.cnaePrincipal) ?? null });
  if (e.cnaesSecundarios.length) p.secondaryCnaes = dp(e.cnaesSecundarios.map((c) => ({ code: formatCnae(c), description: cnaes.get(c) ?? null })));
  const city = e.municipioCodigo ? (municipios.get(e.municipioCodigo) ?? null) : null;
  p.address = dp({ street: [e.logradouro, e.numero, e.complemento].filter(Boolean).join(", ") || null, neighborhood: e.bairro, city, state: e.uf, postalCode: e.cep });
  if (empresa?.porte && PORTE[empresa.porte]) p.taxSizeClass = dp(PORTE[empresa.porte]!, "porte da empresa no cadastro da Receita (ME, EPP ou demais)");
  if (empresa?.capitalSocial != null) p.shareCapital = dp(empresa.capitalSocial);
  if (socios) p.partnersCount = dp(socios.quantidade, "só a quantidade; nomes e CPF não são importados");
  const units = [e, ...branches];
  p.branches = dp(
    branches.map((b) => ({ cnpj: b.cnpj, name: b.nomeFantasia, unitType: b.matrizFilial === "1" ? "MATRIZ" : "FILIAL", status: b.situacao ? (SITUACAO[b.situacao] ?? null) : null, city: b.municipioCodigo ? (municipios.get(b.municipioCodigo) ?? null) : null, state: b.uf })),
    units.length > 20 ? "lista limitada às 20 primeiras unidades do recorte importado" : "unidades presentes no recorte importado",
  );
  return p;
}

type CompanyInput = { name: string; cnpj: string | null; city: string | null; state: string | null; website: string | null; phones: string[] };
export type ReceitaDecision =
  | { decision: "LINK"; cnpj: string; identifiedBy: "cnpj_known" | "match"; matchedBy: string[]; confidence: number }
  | { decision: "ASK"; candidates: MatchCandidate[]; reason: string }
  | { decision: "NOT_FOUND"; reason: string };

const nationalDigits = (raw: string) => {
  const p = normalizePhone(raw);
  return p?.valid && p.e164.startsWith("+55") ? p.e164.slice(3) : null;
};

/** Decide a identificação na base local (pura o bastante para testar com dados sintéticos). */
export async function identifyInReceita(c: CompanyInput): Promise<ReceitaDecision> {
  const cnpj = cnpjDigits(c.cnpj);
  if (cnpj && isValidCnpj(cnpj)) {
    const hit = await prisma.rfEstabelecimento.findUnique({ where: { cnpj }, select: { cnpj: true } });
    return hit ? { decision: "LINK", cnpj, identifiedBy: "cnpj_known", matchedBy: ["cnpj"], confidence: 1 } : { decision: "NOT_FOUND", reason: "O CNPJ da empresa não está no recorte importado da Receita (importe a UF/município dela)." };
  }
  const phones = [...new Set(c.phones.map(nationalDigits).filter((x): x is string => !!x))];
  const domain = normDomain(c.website);
  const strongDomain = domain && !isGenericDomain(domain) ? domain : null;
  const or: Prisma.RfEstabelecimentoWhereInput[] = [...(phones.length ? [{ telefones: { hasSome: phones } }] : []), ...(strongDomain ? [{ emailDominio: strongDomain }] : [])];
  const strong = or.length ? await prisma.rfEstabelecimento.findMany({ where: { OR: or, ...(c.state ? { uf: c.state } : {}) }, take: 10 }) : [];
  const names = await prisma.rfEmpresa.findMany({ where: { cnpjBasico: { in: strong.map((s) => s.cnpjBasico) } }, select: { cnpjBasico: true, razaoSocial: true } });
  const razao = new Map(names.map((n) => [n.cnpjBasico, n.razaoSocial]));
  const cities = await codes("municipio", strong.map((s) => s.municipioCodigo));
  const sameCity = (code: string | null) => !c.city || !code || !cities.get(code) || fold(cities.get(code)!) === fold(c.city);
  const scored = strong.map((s) => {
    const by = [...(s.telefones.some((t) => phones.includes(t)) ? ["telefone"] : []), ...(strongDomain && s.emailDominio === strongDomain ? ["dominio"] : [])];
    const sim = Math.max(nameSimilarity(c.name, s.nomeFantasia ?? ""), nameSimilarity(c.name, razao.get(s.cnpjBasico) ?? ""));
    return { s, by, sim, city: sameCity(s.municipioCodigo) };
  });
  const toCand = (x: (typeof scored)[number]): MatchCandidate => ({ cnpj: x.s.cnpj, legalName: razao.get(x.s.cnpjBasico) ?? null, tradeName: x.s.nomeFantasia, confidence: Math.round(Math.min(0.99, 0.6 + 0.2 * x.by.length + 0.3 * x.sim) * 100) / 100, matchedBy: [...x.by, ...(x.sim >= MIN_NAME_SIMILARITY ? ["nome"] : [])] });
  const good = scored.filter((x) => x.city && x.sim >= MIN_NAME_SIMILARITY);
  if (good.length === 1 && scored.length === 1) return { decision: "LINK", cnpj: good[0]!.s.cnpj, identifiedBy: "match", matchedBy: [...good[0]!.by, "nome"], confidence: toCand(good[0]!).confidence };
  if (scored.length) return { decision: "ASK", candidates: scored.map(toCand).sort((a, b) => b.confidence - a.confidence).slice(0, 5), reason: good.length > 1 || scored.length > 1 ? "Mais de um estabelecimento com o mesmo telefone ou domínio: confirme qual é." : "Telefone ou domínio iguais, mas o nome ou a cidade não conferem: confirme." };
  // só pelo nome: candidatos na mesma cidade/UF, nunca vínculo automático
  const token = [...new Set(fold(c.name).split(" ").filter((t) => t.length > 3))].sort((a, b) => b.length - a.length)[0];
  if (!token || !c.state) return { decision: "NOT_FOUND", reason: "Sem CNPJ, telefone ou domínio que exista no recorte importado." };
  const byName = await prisma.rfEstabelecimento.findMany({ where: { uf: c.state, nomeFolded: { contains: token } }, take: 50 });
  const nameCities = await codes("municipio", byName.map((s) => s.municipioCodigo));
  const cands = byName
    .filter((s) => !c.city || !s.municipioCodigo || fold(nameCities.get(s.municipioCodigo) ?? c.city) === fold(c.city))
    .map((s) => ({ s, sim: nameSimilarity(c.name, s.nomeFantasia ?? "") }))
    .filter((x) => x.sim >= 0.6)
    .sort((a, b) => b.sim - a.sim)
    .slice(0, 5)
    .map((x): MatchCandidate => ({ cnpj: x.s.cnpj, legalName: null, tradeName: x.s.nomeFantasia, confidence: Math.round(x.sim * 0.7 * 100) / 100, matchedBy: ["nome"] }));
  return cands.length ? { decision: "ASK", candidates: cands, reason: "Encontrado só pelo nome: empresas homônimas não são vinculadas sem confirmação." } : { decision: "NOT_FOUND", reason: "Nenhum estabelecimento correspondente no recorte importado." };
}

export async function currentReceita(organizationId: string, companyId: string) {
  const row = await prisma.companyDataProfile.findUnique({ where: { organizationId_companyId_provider: { organizationId, companyId, provider: RECEITA_PROVIDER } } });
  return profileDto(row);
}

/** Identifica e grava o cadastro oficial da base local; com `chosenCnpj`, é a confirmação de uma pessoa. */
export async function receitaForCompany(input: { organizationId: string; companyId: string; userId: string | null; chosenCnpj?: string }) {
  await assertEnabled(input.organizationId, "receita_aberta");
  const c = await prisma.company.findFirst({ where: { id: input.companyId, organizationId: input.organizationId }, select: { id: true, name: true, cnpj: true, legalName: true, city: true, state: true, website: true, contacts: { where: { type: { in: ["PHONE", "WHATSAPP"] }, status: { not: "INVALID" } }, select: { normalizedValue: true } } } });
  if (!c) throw new SourceError("NOT_FOUND", "empresa não encontrada");
  const where = { organizationId_companyId_provider: { organizationId: input.organizationId, companyId: c.id, provider: RECEITA_PROVIDER } };
  return tracked({ source: "receita_aberta", operation: "company", organizationId: input.organizationId, companyId: c.id }, async () => {
    let decision: ReceitaDecision;
    if (input.chosenCnpj) {
      const chosen = cnpjDigits(input.chosenCnpj);
      const prev = await prisma.companyDataProfile.findUnique({ where });
      // só pode confirmar um candidato que o próprio Prospecta ofereceu
      if (!((prev?.candidates as MatchCandidate[] | null) ?? []).some((x) => x.cnpj === chosen)) throw new SourceError("INVALID_REQUEST", "Escolha um dos candidatos encontrados.");
      decision = { decision: "LINK", cnpj: chosen, identifiedBy: "match", matchedBy: ["confirmado"], confidence: 1 };
    } else {
      decision = await identifyInReceita({ name: c.name, cnpj: c.cnpj, city: c.city, state: c.state, website: c.website, phones: c.contacts.map((x) => x.normalizedValue) });
    }
    const now = new Date();
    const base = { organizationId: input.organizationId, companyId: c.id, provider: RECEITA_PROVIDER };
    let data: Omit<Prisma.CompanyDataProfileUncheckedCreateInput, "organizationId" | "companyId" | "provider">;
    if (decision.decision === "LINK") {
      const profile = await receitaProfile(decision.cnpj);
      if (!profile) throw new SourceError("NOT_FOUND", "CNPJ fora do recorte importado");
      const identifiedBy = input.chosenCnpj ? "manual_choice" : decision.identifiedBy;
      data = { status: "MATCHED", cnpj: decision.cnpj, matchConfidence: decision.confidence, matchedBy: decision.matchedBy, identifiedBy, profile: profile as unknown as Prisma.InputJsonValue, candidates: [], warnings: [], buckets: ["cadastro"], fetchedAt: now, errorCode: null, error: null };
      // grava na empresa só o que falta, com procedência (nada válido é sobrescrito)
      const patch: Prisma.CompanyUpdateInput = {};
      if (!isValidCnpj(c.cnpj)) patch.cnpj = decision.cnpj;
      if (!c.legalName && profile.legalName) patch.legalName = profile.legalName.value;
      const conf = identifiedBy === "cnpj_known" ? 0.95 : Math.min(0.95, decision.confidence);
      await prisma.$transaction([
        ...(Object.keys(patch).length ? [prisma.company.update({ where: { id: c.id }, data: patch })] : []),
        prisma.companyFieldSource.createMany({
          data: [
            { organizationId: input.organizationId, companyId: c.id, field: "cnpj", value: decision.cnpj, source: "RECEITA_DADOS_ABERTOS", sourceRef: `Receita dados abertos (${identifiedBy})`, status: "VERIFIED", confidence: conf },
            ...(profile.legalName ? [{ organizationId: input.organizationId, companyId: c.id, field: "legalName", value: profile.legalName.value, source: "RECEITA_DADOS_ABERTOS" as const, sourceRef: "Receita dados abertos", status: "VERIFIED" as const, confidence: conf }] : []),
          ],
        }),
      ]);
    } else if (decision.decision === "ASK") {
      data = { status: "CANDIDATES", cnpj: null, matchConfidence: null, matchedBy: [], identifiedBy: null, profile: undefined, candidates: decision.candidates as unknown as Prisma.InputJsonValue, warnings: [decision.reason], buckets: [], fetchedAt: now, errorCode: null, error: null };
    } else {
      data = { status: "NOT_FOUND", cnpj: null, matchConfidence: null, matchedBy: [], identifiedBy: null, profile: undefined, candidates: [], warnings: [decision.reason], buckets: [], fetchedAt: now, errorCode: null, error: null };
    }
    const row = await prisma.companyDataProfile.upsert({ where, create: { ...base, ...data }, update: data });
    if (decision.decision === "LINK") await writeAudit(null, { action: "company.receita_linked", organizationId: input.organizationId, userId: input.userId, entityType: "company", entityId: c.id, metadata: { identifiedBy: row.identifiedBy } });
    return { value: profileDto(row), records: decision.decision === "LINK" ? 1 : 0 };
  });
}
