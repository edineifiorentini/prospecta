/**
 * Catálogo das integrações de dados (Central de integrações). Cada fonte tem uma responsabilidade clara e
 * começa desligada, exceto os recursos que o Prospecta já usava (BrasilAPI e Lighthouse local), que seguem ligados.
 *
 * - scope "company": dado de uma empresa específica (vínculo só por identificador válido, como o CNPJ).
 * - scope "regional": estatística agregada de município/UF — nunca é atribuída a uma empresa.
 * - scope "catalog": catálogo público consultado à parte (ex.: contratações do PNCP).
 */
export const PUBLIC_SOURCE_IDS = ["brasilapi", "lighthouse", "pagespeed", "receita_aberta", "pncp", "transparencia", "ibge", "comexstat", "caged", "cvm"] as const;
export type PublicSourceId = (typeof PUBLIC_SOURCE_IDS)[number];

export type SourceKind = "identificacao" | "cadastral" | "digital" | "contratacoes" | "economico" | "emprego" | "comercio_exterior" | "financeiro";
/** como a fonte é acessada: API sem cadastro, API com chave/token gratuito, ou base local importada de arquivos oficiais */
export type SourceAccess = "api" | "api_chave_gratuita" | "arquivo_local";

export type SourceDef = {
  id: PublicSourceId;
  name: string;
  kind: SourceKind;
  scope: "company" | "regional" | "catalog";
  access: SourceAccess;
  /** onde obter a credencial gratuita (quando houver) */
  credentialUrl?: string;
  docsUrl: string;
  /** recurso que já existia no Prospecta antes da Central (mantém o comportamento: ligado por padrão) */
  existing?: boolean;
  /** requisições por minuto que o Prospecta se impõe (abaixo do limite documentado pela fonte) */
  ratePerMinute: number;
  defaults: { enabled: boolean; concurrency: number; cacheDays: number; maxDailyRequests: number; scheduled: boolean };
  /** o que a fonte entrega e o que ela não permite concluir */
  description: string;
  caveat: string;
};

export const PUBLIC_SOURCES: SourceDef[] = [
  {
    id: "brasilapi",
    name: "Receita Federal (BrasilAPI)",
    kind: "identificacao",
    scope: "company",
    access: "api",
    docsUrl: "https://brasilapi.com.br/docs#tag/CNPJ",
    existing: true,
    ratePerMinute: 30,
    defaults: { enabled: true, concurrency: 1, cacheDays: 30, maxDailyRequests: 500, scheduled: false },
    description: "Confirma razão social e situação do CNPJ publicado no site oficial da empresa.",
    caveat: "Só consulta CNPJ encontrado no site; não identifica empresa pelo nome.",
  },
  {
    id: "lighthouse",
    name: "Google Lighthouse (local)",
    kind: "digital",
    scope: "company",
    access: "api",
    docsUrl: "https://github.com/GoogleChrome/lighthouse",
    existing: true,
    ratePerMinute: 10,
    defaults: { enabled: true, concurrency: 1, cacheDays: 7, maxDailyRequests: 200, scheduled: false },
    description: "Mede desempenho, acessibilidade, boas práticas e SEO no próprio servidor (perfil celular).",
    caveat: "Precisa do Chromium instalado; sem ele, a auditoria segue com as demais verificações.",
  },
  {
    id: "pagespeed",
    name: "Google PageSpeed Insights",
    kind: "digital",
    scope: "company",
    access: "api_chave_gratuita",
    credentialUrl: "https://developers.google.com/speed/docs/insights/v5/get-started#APIKey",
    docsUrl: "https://developers.google.com/speed/docs/insights/v5/get-started",
    ratePerMinute: 30,
    defaults: { enabled: false, concurrency: 1, cacheDays: 7, maxDailyRequests: 100, scheduled: false },
    description: "Lighthouse remoto para celular e computador, mais dados reais de usuários do Chrome (INP, LCP, CLS) quando o site tem tráfego suficiente.",
    caveat: "Sem chave, a cota anônima do Google costuma estar esgotada (erro 429). A URL do site é enviada ao Google.",
  },
  {
    id: "receita_aberta",
    name: "Receita Federal (dados abertos do CNPJ)",
    kind: "cadastral",
    scope: "company",
    access: "arquivo_local",
    docsUrl: "https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/dados-abertos",
    ratePerMinute: 600,
    defaults: { enabled: false, concurrency: 2, cacheDays: 30, maxDailyRequests: 5000, scheduled: false },
    description: "Cadastro oficial (situação, CNAE, abertura, natureza, capital, matriz e filiais) a partir de um recorte importado localmente.",
    caveat: "Só funciona para as UFs/municípios importados. Empresa sem CNPJ só é vinculada por telefone ou domínio iguais; nunca só pelo nome.",
  },
  {
    id: "pncp",
    name: "PNCP (contratações públicas)",
    kind: "contratacoes",
    scope: "catalog",
    access: "api",
    docsUrl: "https://pncp.gov.br/api/consulta/swagger-ui/index.html",
    ratePerMinute: 20,
    defaults: { enabled: false, concurrency: 1, cacheDays: 1, maxDailyRequests: 300, scheduled: false },
    description: "Radar de oportunidades públicas: contratações publicadas e com propostas abertas, por UF, município e período.",
    caveat: "Mostra o que órgãos públicos querem contratar. O órgão é o comprador; não é um lead nem fornecedor.",
  },
  {
    id: "transparencia",
    name: "Portal da Transparência (CGU)",
    kind: "contratacoes",
    scope: "company",
    access: "api_chave_gratuita",
    credentialUrl: "https://portaldatransparencia.gov.br/api-de-dados/cadastrar-email",
    docsUrl: "https://portaldatransparencia.gov.br/api-de-dados",
    ratePerMinute: 30,
    defaults: { enabled: false, concurrency: 1, cacheDays: 30, maxDailyRequests: 300, scheduled: false },
    description: "Registros públicos ligados ao CNPJ: sanções (CEIS e CNEP) e contratos com o governo federal.",
    caveat: "Registro de sanção não significa, sozinho, que a empresa é irregular: confira vigência, órgão e contexto.",
  },
  {
    id: "ibge",
    name: "IBGE (API de dados agregados)",
    kind: "economico",
    scope: "regional",
    access: "api",
    docsUrl: "https://servicodados.ibge.gov.br/api/docs/",
    ratePerMinute: 30,
    defaults: { enabled: false, concurrency: 1, cacheDays: 90, maxDailyRequests: 500, scheduled: false },
    description: "População, PIB e Cadastro Central de Empresas (unidades locais e pessoal ocupado por seção CNAE) do município.",
    caveat: "Estatística do município, com ano de referência próprio. Não descreve nenhuma empresa específica.",
  },
  {
    id: "comexstat",
    name: "Comex Stat (MDIC)",
    kind: "comercio_exterior",
    scope: "regional",
    access: "api",
    docsUrl: "https://api-comexstat.mdic.gov.br/docs",
    ratePerMinute: 10,
    defaults: { enabled: false, concurrency: 1, cacheDays: 30, maxDailyRequests: 200, scheduled: false },
    description: "Exportações e importações do município: valor FOB (US$), peso, produtos e países.",
    caveat: "Agregado pelo domicílio fiscal de quem declarou. Não indica que uma empresa da cidade exporta.",
  },
  {
    id: "caged",
    name: "Novo CAGED (MTE)",
    kind: "emprego",
    scope: "regional",
    access: "arquivo_local",
    docsUrl: "https://www.gov.br/trabalho-e-emprego/pt-br/assuntos/estatisticas-trabalho/microdados-rais-e-caged",
    ratePerMinute: 600,
    defaults: { enabled: false, concurrency: 2, cacheDays: 30, maxDailyRequests: 5000, scheduled: false },
    description: "Admissões, desligamentos e saldo de empregos por município e seção CNAE, a partir dos microdados importados.",
    caveat: "Tendência do setor na cidade; não é o número de funcionários de nenhuma empresa.",
  },
  {
    id: "cvm",
    name: "CVM (companhias abertas)",
    kind: "financeiro",
    scope: "company",
    access: "arquivo_local",
    docsUrl: "https://dados.cvm.gov.br/dataset/cia_aberta-doc-dfp",
    ratePerMinute: 600,
    defaults: { enabled: false, concurrency: 2, cacheDays: 90, maxDailyRequests: 5000, scheduled: false },
    description: "Demonstrações financeiras padronizadas (receita, resultado, ativo, passivo, patrimônio) de companhias abertas.",
    caveat: "Só existe para companhias registradas na CVM com o mesmo CNPJ. Empresas fechadas não aparecem aqui.",
  },
];

export const sourceDef = (id: PublicSourceId) => PUBLIC_SOURCES.find((s) => s.id === id)!;
