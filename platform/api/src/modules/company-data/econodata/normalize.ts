import type { BusinessProfile, DataNature, DataPoint, Range } from "../types.ts";

/**
 * Resposta da Econodata (CompanyView, openapi.yaml) → BusinessProfile.
 * Regras:
 * - campo ausente ou nulo no fornecedor fica AUSENTE no perfil (a tela mostra "Não disponível", nunca zero);
 * - dados da Receita (bloco cadastro) são OFFICIAL;
 * - faturamento e funcionários com origem "Presumido" são ESTIMATED; com outra origem, DECLARED;
 * - porte é classificação do fornecedor (ESTIMATED); comércio exterior é indicador de anos, não volume;
 * - sócios: só a quantidade (nomes e CPF são dados pessoais e não são guardados).
 */

type Nullable<T> = T | null | undefined;
type SizeMetric = { de?: Nullable<number>; ate?: Nullable<number>; valor?: Nullable<number>; total?: Nullable<number>; origem?: Nullable<string> };

export type EconodataCompany = {
  cnpj: string;
  cadastro?: {
    razaoSocial?: Nullable<string>;
    nomeFantasia?: Nullable<string>;
    tipoUnidade?: Nullable<string>;
    situacao?: Nullable<string>;
    uf?: Nullable<string>;
    cidade?: Nullable<string>;
    setores?: Nullable<string[]>;
    cnaePrimario?: Nullable<{ codigo?: Nullable<string>; descricao?: Nullable<string> }>;
    cnaesSecundarios?: Nullable<{ cnae?: Nullable<string>; descricao?: Nullable<string> }[]>;
    endereco?: Nullable<{ logradouro?: Nullable<string>; bairro?: Nullable<string>; cidade?: Nullable<string>; uf?: Nullable<string>; cep?: Nullable<string> }>;
    naturezaJuridica?: Nullable<{ codigo?: Nullable<string>; nome?: Nullable<string> }>;
    situacaoCadastral?: Nullable<{ tipo?: Nullable<string>; data?: Nullable<string> }>;
    regimeTributario?: Nullable<{ atual?: Nullable<string> }>;
    enquadramentoPorte?: Nullable<string>;
    dataAbertura?: Nullable<string>;
    capitalSocial?: Nullable<number>;
    nivelAtividade?: Nullable<string>;
    socios?: Nullable<unknown[]>;
  };
  estrategico?: {
    headcountCnpj?: Nullable<SizeMetric>;
    faturamentoCnpj?: Nullable<SizeMetric>;
    headcountMatrizFiliais?: Nullable<SizeMetric>;
    faturamentoMatrizFiliais?: Nullable<SizeMetric>;
    tecnologias?: Nullable<{ tecnologias?: Nullable<string[]> }>;
  };
  perfilNegocio?: {
    porte?: Nullable<string>;
    recebimentosGoverno?: Nullable<number>;
    comercioExterior?: Nullable<{ exportacaoAnos?: Nullable<string[]>; importacaoAnos?: Nullable<string[]> }>;
    situacaoCrescimentoSetor?: Nullable<string>;
    raizCnpj?: Nullable<string>;
    nome?: Nullable<string>;
    ufs?: Nullable<string[]>;
    filiais?: Nullable<{ cnpj: string; razaoSocial?: Nullable<string>; nomeFantasia?: Nullable<string>; tipoUnidade?: Nullable<string>; situacao?: Nullable<string>; uf?: Nullable<string>; cidade?: Nullable<string> }[]>;
  };
  contatosBasicos?: {
    telefones?: Nullable<{ numero?: Nullable<string>; tipo?: Nullable<string>; temWhatsapp?: Nullable<boolean>; assertividade?: Nullable<string> }[]>;
    emailReceita?: Nullable<string>;
    emailsValidadosSetores?: Nullable<string[]>;
    emailsPublicos?: Nullable<{ email?: Nullable<string> }[]>;
  };
  contatosAvancados?: {
    decisores?: Nullable<{ itens?: Nullable<{ nome?: Nullable<string>; cargos?: Nullable<string[]>; classificacaoMacro?: Nullable<string[]>; nivelDecisao?: Nullable<string> }[]> }>;
  };
};

const str = (v: Nullable<string>) => (typeof v === "string" && v.trim() ? v.trim() : null);
const onlyDigits = (v: string) => v.replace(/\D/g, "");

export function normalizeEconodata(e: EconodataCompany, ctx: { provider: string; simulated: boolean; fetchedAt: string; buckets: string[] }): BusinessProfile {
  const label = ctx.simulated ? "Econodata (simulado)" : "Econodata";
  const dp = <T>(value: T | null | undefined, nature: DataNature, bucket: string, note?: string | null): DataPoint<T> | undefined =>
    value == null || (Array.isArray(value) && value.length === 0) ? undefined : { value, nature, source: `${label} · ${bucket}`, fetchedAt: ctx.fetchedAt, ...(note ? { note } : {}) };

  /** faixa do fornecedor: origem "Presumido" é estimativa */
  const range = (m: Nullable<SizeMetric>, bucket: string): DataPoint<Range> | undefined => {
    if (!m) return undefined;
    const r: Range = { min: m.de ?? null, max: m.ate ?? null, value: m.valor ?? m.total ?? null };
    if (r.min == null && r.max == null && r.value == null) return undefined;
    const presumed = /presumid/i.test(m.origem ?? "");
    return dp(r, presumed ? "ESTIMATED" : "DECLARED", bucket, m.origem ? `origem informada: ${m.origem}` : null);
  };

  const c = e.cadastro;
  const s = e.estrategico;
  const p = e.perfilNegocio;
  const cb = e.contatosBasicos;
  const ca = e.contatosAvancados;
  const addr = c?.endereco;
  const out: BusinessProfile = { provider: ctx.provider, simulated: ctx.simulated, fetchedAt: ctx.fetchedAt, cnpj: onlyDigits(e.cnpj), buckets: ctx.buckets };

  if (c) {
    out.legalName = dp(str(c.razaoSocial), "OFFICIAL", "cadastro");
    out.tradeName = dp(str(c.nomeFantasia), "OFFICIAL", "cadastro");
    out.unitType = dp(str(c.tipoUnidade), "OFFICIAL", "cadastro");
    out.registrationStatus = dp(str(c.situacao) ?? str(c.situacaoCadastral?.tipo), "OFFICIAL", "cadastro");
    out.registrationStatusDate = dp(str(c.situacaoCadastral?.data), "OFFICIAL", "cadastro");
    out.openedAt = dp(str(c.dataAbertura)?.slice(0, 10) ?? null, "OFFICIAL", "cadastro");
    out.legalNature = dp(str(c.naturezaJuridica?.nome), "OFFICIAL", "cadastro");
    const primary = c.cnaePrimario && (str(c.cnaePrimario.codigo) || str(c.cnaePrimario.descricao)) ? { code: str(c.cnaePrimario.codigo), description: str(c.cnaePrimario.descricao) } : null;
    out.primaryCnae = dp(primary, "OFFICIAL", "cadastro");
    out.secondaryCnaes = dp((c.cnaesSecundarios ?? []).map((x) => ({ code: str(x.cnae), description: str(x.descricao) })).filter((x) => x.code || x.description), "OFFICIAL", "cadastro");
    out.sectors = dp((c.setores ?? []).filter((x) => !!str(x)), "ESTIMATED", "cadastro", "setor amigável atribuído pelo fornecedor");
    const address = addr && (str(addr.logradouro) || str(addr.cidade)) ? { street: str(addr.logradouro), neighborhood: str(addr.bairro), city: str(addr.cidade) ?? str(c.cidade), state: str(addr.uf) ?? str(c.uf), postalCode: str(addr.cep) } : null;
    out.address = dp(address ?? (str(c.cidade) ? { street: null, neighborhood: null, city: str(c.cidade), state: str(c.uf), postalCode: null } : null), "OFFICIAL", "cadastro");
    out.taxRegime = dp(str(c.regimeTributario?.atual), "OFFICIAL", "cadastro");
    out.taxSizeClass = dp(str(c.enquadramentoPorte), "OFFICIAL", "cadastro");
    out.shareCapital = dp(typeof c.capitalSocial === "number" ? c.capitalSocial : null, "OFFICIAL", "cadastro");
    out.activityLevel = dp(str(c.nivelAtividade), "ESTIMATED", "cadastro", "classificação do fornecedor");
    out.partnersCount = dp(Array.isArray(c.socios) && c.socios.length ? c.socios.length : null, "OFFICIAL", "cadastro", "só a quantidade; nomes e CPF não são guardados");
  }
  if (s) {
    out.employees = range(s.headcountCnpj, "estrategico");
    out.employeesGroup = range(s.headcountMatrizFiliais, "estrategico");
    out.revenue = range(s.faturamentoCnpj, "estrategico");
    out.revenueGroup = range(s.faturamentoMatrizFiliais, "estrategico");
    out.technologies = dp((s.tecnologias?.tecnologias ?? []).filter((x) => !!str(x)), "OBSERVED", "estrategico");
  }
  if (p) {
    out.size = dp(str(p.porte), "ESTIMATED", "perfilNegocio", "classificação de porte do fornecedor");
    out.governmentRevenue = dp(typeof p.recebimentosGoverno === "number" ? p.recebimentosGoverno : null, "OBSERVED", "perfilNegocio", "recebimentos de órgãos públicos (licitações)");
    const ex = (p.comercioExterior?.exportacaoAnos ?? []).filter(Boolean);
    const im = (p.comercioExterior?.importacaoAnos ?? []).filter(Boolean);
    out.foreignTrade = dp(ex.length || im.length ? { exportYears: ex, importYears: im } : null, "OBSERVED", "perfilNegocio", "anos com registro de operação; não informa volume nem valor");
    out.sectorGrowth = dp(str(p.situacaoCrescimentoSetor), "ESTIMATED", "perfilNegocio", "tendência do setor, não da empresa");
    out.group = dp(str(p.raizCnpj) || str(p.nome) ? { rootCnpj: str(p.raizCnpj), name: str(p.nome), states: (p.ufs ?? []).filter(Boolean) } : null, "OFFICIAL", "perfilNegocio");
    out.branches = dp(
      (p.filiais ?? []).map((f) => ({ cnpj: onlyDigits(f.cnpj), name: str(f.nomeFantasia) ?? str(f.razaoSocial), unitType: str(f.tipoUnidade), status: str(f.situacao), city: str(f.cidade), state: str(f.uf) })),
      "OFFICIAL",
      "perfilNegocio",
    );
  }
  if (cb) {
    out.phones = dp(
      (cb.telefones ?? []).filter((t) => !!str(t.numero)).map((t) => ({ number: str(t.numero)!, type: str(t.tipo), hasWhatsapp: t.temWhatsapp ?? null, assertiveness: str(t.assertividade) })),
      "OBSERVED",
      "contatosBasicos",
      "WhatsApp informado pelo fornecedor; confirme antes de usar",
    );
    const emails = [str(cb.emailReceita), ...(cb.emailsValidadosSetores ?? []).map(str), ...(cb.emailsPublicos ?? []).map((x) => str(x.email))].filter((x): x is string => !!x);
    out.emails = dp([...new Set(emails.map((x) => x.toLowerCase()))], "OBSERVED", "contatosBasicos");
  }
  if (ca) {
    out.decisionMakers = dp(
      (ca.decisores?.itens ?? []).map((d) => ({ name: str(d.nome), roles: (d.cargos ?? []).filter(Boolean), departments: (d.classificacaoMacro ?? []).filter(Boolean), level: str(d.nivelDecisao) })).filter((d) => d.name),
      "OBSERVED",
      "contatosAvancados",
      "dados pessoais (LGPD): use só para a abordagem comercial legítima",
    );
  }
  // tira as chaves que ficaram indefinidas
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined)) as BusinessProfile;
}
