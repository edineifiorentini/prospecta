/**
 * Dados empresariais de provedores externos, num modelo interno independente do fornecedor.
 * A Econodata (API v4) é o primeiro provedor; outro pode ser acrescentado implementando
 * DataProvider e um normalizador para BusinessProfile, sem mexer no resto do sistema.
 */

/** Natureza do dado: o que a tela e a IA podem afirmar sobre ele. */
export type DataNature =
  /** registro oficial (Receita Federal, cadastros públicos) */
  | "OFFICIAL"
  /** informado pela própria empresa ou por terceiros, sem verificação oficial */
  | "DECLARED"
  /** observado pelo fornecedor (site, registros, redes) */
  | "OBSERVED"
  /** estimativa ou classificação do fornecedor (ex.: faturamento "Presumido") */
  | "ESTIMATED";

export type DataPoint<T> = {
  value: T;
  nature: DataNature;
  /** fornecedor e bloco de onde veio (ex.: "Econodata · cadastro") */
  source: string;
  fetchedAt: string;
  note?: string | null;
};

/** Faixa numérica: limites abertos ficam nulos; `value` só quando o fornecedor dá um valor pontual. */
export type Range = { min: number | null; max: number | null; value: number | null };

export type Cnae = { code: string | null; description: string | null };

export type Branch = { cnpj: string; name: string | null; unitType: string | null; status: string | null; city: string | null; state: string | null };

export type BusinessProfile = {
  provider: string;
  /** dados simulados (modo de teste): nunca devem ser tratados como reais */
  simulated: boolean;
  fetchedAt: string;
  cnpj: string;
  buckets: string[];
  legalName?: DataPoint<string>;
  tradeName?: DataPoint<string>;
  unitType?: DataPoint<string>;
  registrationStatus?: DataPoint<string>;
  registrationStatusDate?: DataPoint<string>;
  openedAt?: DataPoint<string>;
  legalNature?: DataPoint<string>;
  primaryCnae?: DataPoint<Cnae>;
  secondaryCnaes?: DataPoint<Cnae[]>;
  sectors?: DataPoint<string[]>;
  address?: DataPoint<{ street: string | null; neighborhood: string | null; city: string | null; state: string | null; postalCode: string | null }>;
  taxRegime?: DataPoint<string>;
  /** enquadramento na Receita: ME, EPP, MEI ou "Sem Enquadramento" */
  taxSizeClass?: DataPoint<string>;
  shareCapital?: DataPoint<number>;
  /** porte segundo a classificação do fornecedor: INDIVIDUAL, MICRO, PEQUENO, MEDIO, GRANDE */
  size?: DataPoint<string>;
  employees?: DataPoint<Range>;
  employeesGroup?: DataPoint<Range>;
  /** faturamento anual em reais */
  revenue?: DataPoint<Range>;
  revenueGroup?: DataPoint<Range>;
  /** anos com registro de exportação/importação: indicador, não volume */
  foreignTrade?: DataPoint<{ exportYears: string[]; importYears: string[] }>;
  group?: DataPoint<{ rootCnpj: string | null; name: string | null; states: string[] }>;
  branches?: DataPoint<Branch[]>;
  governmentRevenue?: DataPoint<number>;
  sectorGrowth?: DataPoint<string>;
  technologies?: DataPoint<string[]>;
  activityLevel?: DataPoint<string>;
  /** só a quantidade de sócios: nomes e CPFs (dados pessoais) não são guardados */
  partnersCount?: DataPoint<number>;
  /** contatos só existem quando a conta liberou os blocos de contato (dados pessoais, LGPD) */
  phones?: DataPoint<{ number: string; type: string | null; hasWhatsapp: boolean | null; assertiveness: string | null }[]>;
  emails?: DataPoint<string[]>;
  decisionMakers?: DataPoint<{ name: string | null; roles: string[]; departments: string[]; level: string | null }[]>;
};

/** Candidato de uma identificação ambígua: só identificação, sem dado pago. */
export type MatchCandidate = { cnpj: string; legalName: string | null; tradeName: string | null; confidence: number; matchedBy: string[] };

/** Critérios para identificar uma empresa no fornecedor. */
export type MatchCriteria = { cnpj?: string; name?: string; state?: string; site?: string; phone?: string; email?: string };

export type ProviderErrorCode =
  | "NOT_CONFIGURED"
  | "AUTH"
  | "FORBIDDEN"
  | "INSUFFICIENT_BALANCE"
  | "NOT_FOUND"
  | "INVALID_REQUEST"
  | "RATE_LIMIT"
  | "UNAVAILABLE"
  | "LIMIT_EXCEEDED";

const MESSAGES: Record<ProviderErrorCode, string> = {
  NOT_CONFIGURED: "Provedor de dados empresariais sem chave cadastrada nesta conta.",
  AUTH: "A chave do provedor foi recusada (inválida ou revogada).",
  FORBIDDEN: "A chave não tem permissão para esta operação (escopo ou chave de teste).",
  INSUFFICIENT_BALANCE: "Saldo de tokens insuficiente no provedor. Nada foi cobrado.",
  NOT_FOUND: "O provedor não encontrou a empresa.",
  INVALID_REQUEST: "O provedor recusou os parâmetros da consulta.",
  RATE_LIMIT: "Limite de requisições do provedor atingido. Tente em instantes.",
  UNAVAILABLE: "O provedor está indisponível agora.",
  LIMIT_EXCEEDED: "Limite de consumo configurado nesta conta atingido.",
};

const RETRYABLE = new Set<ProviderErrorCode>(["RATE_LIMIT", "UNAVAILABLE"]);

export class ProviderError extends Error {
  constructor(
    public code: ProviderErrorCode,
    public detail: string | null = null,
    public httpStatus: number | null = null,
    /** espera sugerida pelo provedor antes de tentar de novo (429) */
    public retryAfterMs: number | null = null,
  ) {
    super(MESSAGES[code]);
  }
  get retryable() {
    return RETRYABLE.has(this.code);
  }
}
