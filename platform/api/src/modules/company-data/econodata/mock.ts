import { createHash } from "node:crypto";
import { fold } from "../../../lib/normalize.ts";
import { cnpjDigits, formatCnpj, withCheckDigits } from "../cnpj.ts";
import type { EconodataCompany } from "./normalize.ts";

/**
 * Econodata SIMULADA: implementa o contrato HTTP da API v4 (mesmos caminhos, cabeçalhos, erros
 * RFC 7807 e X-Tokens-Charged) com dados sintéticos e determinísticos. Serve para desenvolver e
 * testar sem chave e sem gastar tokens; nunca é usada em produção (ver service.ts).
 *
 * Cenários disparados por palavras no nome, no site ou na chave (sem acento, minúsculas):
 * - "ambigua": dois candidatos com confiança parecida, sem dado (precisa confirmação)
 * - "naoencontrada"/"inexistente": nenhum candidato (grátis)
 * - "indisponivel": 503
 * - "limite": 429 na primeira chamada e sucesso na seguinte; "semprelimite": 429 sempre
 * - "outracidade": cadastro em Curitiba/PR
 * - "baixada": CNPJ com situação BAIXADA
 * - chave com "invalida": 401; chave com "semsaldo": 402 nas chamadas pagas
 * - consulta por CNPJ iniciado em "99": 404
 */

const BASE_COST = { match: 20, lookup: 10 } as const;
const BUCKET_COST: Record<string, number> = { cadastro: 20, estrategico: 40, perfilNegocio: 30, contatosBasicos: 50, contatosAvancados: 120 };

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": status >= 400 ? "application/problem+json" : "application/json", ...headers } });
const problem = (status: number, title: string, detail?: string, headers: Record<string, string> = {}) => json(status, { type: "https://errors.econodata.com.br/simulado", title, status, ...(detail ? { detail } : {}) }, headers);

const hashNum = (seed: string) => Number.parseInt(createHash("sha256").update(seed).digest("hex").slice(0, 8), 16);

/** CNPJ sintético e válido derivado de um texto (o mesmo texto sempre gera o mesmo CNPJ). */
export function syntheticCnpj(seed: string) {
  const base = String(hashNum(seed) % 100_000_000).padStart(8, "0");
  return withCheckDigits(`${base}0001`);
}

function cnaeFor(text: string) {
  const t = fold(text);
  if (/imobili|imove/.test(t)) return { codigo: "L-6821-8/01", descricao: "Corretagem na compra e venda e avaliação de imóveis" };
  if (/contab|contador/.test(t)) return { codigo: "M-6920-6/01", descricao: "Atividades de contabilidade" };
  if (/advoca|advogad|juridic/.test(t)) return { codigo: "M-6911-7/01", descricao: "Serviços advocatícios" };
  if (/marketing|publicidade|propaganda/.test(t)) return { codigo: "N-7311-4/00", descricao: "Agências de publicidade" };
  return { codigo: "M-7020-4/00", descricao: "Atividades de consultoria em gestão empresarial, exceto consultoria técnica específica" };
}

function company(cnpj: string, hints: { name?: string; uf?: string; text: string }, buckets: string[]): EconodataCompany {
  const h = hashNum(cnpj);
  const t = fold(hints.text);
  const otherCity = t.includes("outracidade");
  const name = (hints.name?.trim() || `Empresa Simulada ${cnpj.slice(0, 4)}`).toUpperCase();
  const uf = otherCity ? "PR" : (hints.uf ?? null);
  const out: EconodataCompany = { cnpj: formatCnpj(cnpj)! };
  if (buckets.includes("cadastro")) {
    out.cadastro = {
      razaoSocial: `${name} LTDA`,
      nomeFantasia: hints.name?.trim() || null,
      tipoUnidade: "MATRIZ",
      situacao: t.includes("baixada") ? "BAIXADA" : "ATIVA",
      uf,
      cidade: otherCity ? "Curitiba" : null,
      setores: ["Serviços"],
      cnaePrimario: cnaeFor(`${hints.name ?? ""} ${hints.text}`),
      cnaesSecundarios: [{ cnae: "8219-9/99", descricao: "Preparação de documentos e serviços especializados de apoio administrativo" }],
      endereco: otherCity ? { logradouro: "Rua Simulada, 100", bairro: "Centro", cidade: "Curitiba", uf: "PR", cep: "80000-000" } : null,
      naturezaJuridica: { codigo: "206-2", nome: "Sociedade Empresária Limitada" },
      situacaoCadastral: { tipo: t.includes("baixada") ? "BAIXADA" : "ATIVA", data: "2015-01-01" },
      regimeTributario: { atual: "SIMPLES NACIONAL" },
      enquadramentoPorte: h % 2 ? "ME" : "EPP",
      dataAbertura: `${2005 + (h % 18)}-03-15T00:00:00Z`,
      capitalSocial: ((h % 50) + 1) * 10_000,
      nivelAtividade: "media",
      socios: [{}, {}],
    };
  }
  if (buckets.includes("estrategico")) {
    out.estrategico = {
      headcountCnpj: { de: 10, ate: 19, valor: null, origem: "Presumido" },
      faturamentoCnpj: { de: 1_000_000, ate: 4_800_000, valor: null, origem: "Presumido" },
      headcountMatrizFiliais: null,
      faturamentoMatrizFiliais: null,
      tecnologias: { tecnologias: ["Google Workspace", "WordPress"] },
    };
  }
  if (buckets.includes("perfilNegocio")) {
    out.perfilNegocio = {
      porte: "PEQUENO",
      recebimentosGoverno: null,
      comercioExterior: { exportacaoAnos: h % 4 === 0 ? ["2023", "2024"] : [], importacaoAnos: [] },
      situacaoCrescimentoSetor: "EM CRESCIMENTO",
      raizCnpj: formatCnpj(cnpj)!.slice(0, 10),
      nome: name,
      ufs: uf ? [uf] : [],
    };
  }
  if (buckets.includes("contatosBasicos")) {
    out.contatosBasicos = { telefones: [{ numero: "4433334444", tipo: "fixo", temWhatsapp: false, assertividade: "alta" }], emailReceita: "contato@empresa-simulada.test", emailsValidadosSetores: [], emailsPublicos: [] };
  }
  if (buckets.includes("contatosAvancados")) {
    out.contatosAvancados = { decisores: { itens: [{ nome: "Pessoa Simulada", cargos: ["Sócio-administrador"], classificacaoMacro: ["Sócio/Proprietário"], nivelDecisao: "Alto" }] } };
  }
  return out;
}

const cost = (op: keyof typeof BASE_COST, buckets: string[]) => BASE_COST[op] + buckets.reduce((s, b) => s + (BUCKET_COST[b] ?? 0), 0);

/** Cria um `fetch` que responde como a Econodata, sem rede. */
export function createEconodataMock() {
  const limitedOnce = new Set<string>();
  // a Econodata não recobra a mesma empresa dentro de 24h
  const delivered = new Set<string>();
  // o que o match já "conhece" de cada CNPJ sintético, para a consulta por CNPJ devolver a mesma empresa
  const known = new Map<string, { name?: string; uf?: string; text: string }>();

  return async function mockFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    const headers = new Headers(init?.headers);
    const key = (headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    const estimate = /^(true|1)$/i.test(headers.get("x-estimate-only") ?? "");
    const body = init?.body ? (JSON.parse(String(init.body)) as { criterios?: Record<string, string>; incluir?: string[] }) : {};
    const crit = body.criterios ?? {};
    const buckets = body.incluir ?? [];
    const text = fold([crit.nome, crit.site, crit.email, key].filter(Boolean).join(" "));

    if (!key || fold(key).includes("invalida")) return problem(401, "Unauthorized", "Token ausente ou inválido");
    if (url.pathname === "/v4/account/balance") return json(200, { saldoTokens: fold(key).includes("semsaldo") ? 0 : 50_000 }, { "x-tokens-charged": "0" });
    if (text.includes("indisponivel")) return problem(503, "Service Unavailable", "Fonte de dados de empresa indisponível");
    if (text.includes("semprelimite") || (text.includes("limite") && !limitedOnce.has(text))) {
      limitedOnce.add(text);
      return problem(429, "Too Many Requests", "Limite de 60 requisições por minuto", { "retry-after": "0", "x-ratelimit-remaining": "0" });
    }

    if (url.pathname === "/v4/companies/match") {
      if (!Object.keys(crit).length) return problem(422, "Validation failed", "criterios deve ter ao menos um campo preenchido");
      if (text.includes("naoencontrada") || text.includes("inexistente")) return json(200, { correspondencias: [] }, { "x-tokens-charged": "0" });
      if (estimate) return json(200, { tokensEstimados: cost("match", buckets) }, { "x-tokens-charged": "0" });
      if (fold(key).includes("semsaldo")) return problem(402, "Payment Required", "Saldo de tokens insuficiente");
      if (text.includes("ambigua")) {
        const a = syntheticCnpj(`${text}#1`);
        const b = syntheticCnpj(`${text}#2`);
        return json(200, {
          correspondencias: [
            { cnpj: formatCnpj(a), confianca: 0.82, correspondidoEm: ["nome"], razaoSocial: `${(crit.nome ?? "EMPRESA").toUpperCase()} LTDA`, nomeFantasia: crit.nome ?? null },
            { cnpj: formatCnpj(b), confianca: 0.79, correspondidoEm: ["nome"], razaoSocial: `${(crit.nome ?? "EMPRESA").toUpperCase()} SERVICOS LTDA`, nomeFantasia: `${crit.nome ?? "Empresa"} Filial` },
          ],
        }, { "x-tokens-charged": "0" });
      }
      const cnpj = crit.cnpj ? cnpjDigits(crit.cnpj) : syntheticCnpj(fold(crit.site ?? crit.telefone ?? crit.email ?? crit.nome ?? "x"));
      const matchedBy = [crit.cnpj && "cnpj", crit.site && "site", crit.telefone && "telefone", crit.email && "email", crit.nome && "nome", crit.uf && "uf"].filter(Boolean) as string[];
      const charged = delivered.has(cnpj) ? 0 : cost("match", buckets);
      delivered.add(cnpj);
      known.set(cnpj, { name: crit.nome, uf: crit.uf, text });
      return json(200, { correspondencias: [{ cnpj: formatCnpj(cnpj), confianca: 0.93, correspondidoEm: matchedBy, razaoSocial: `${(crit.nome ?? "EMPRESA SIMULADA").toUpperCase()} LTDA`, nomeFantasia: crit.nome ?? null, empresa: company(cnpj, { name: crit.nome, uf: crit.uf, text }, buckets) }] }, { "x-tokens-charged": String(charged) });
    }

    if (url.pathname === "/v4/companies/search") {
      const cnpj = cnpjDigits(crit.cnpj);
      if (!cnpj) return problem(422, "Validation failed", "criterios deve ter ao menos um campo preenchido");
      if (cnpj.startsWith("99")) return problem(404, "Not Found", "Nenhuma empresa encontrada para os identificadores informados");
      if (estimate) return json(200, { tokensEstimados: cost("lookup", buckets) }, { "x-tokens-charged": "0" });
      if (fold(key).includes("semsaldo")) return problem(402, "Payment Required", "Saldo de tokens insuficiente");
      const charged = delivered.has(`${cnpj}:${buckets.join(",")}`) ? 0 : cost("lookup", buckets);
      delivered.add(`${cnpj}:${buckets.join(",")}`);
      return json(200, { empresa: company(cnpj, known.get(cnpj) ?? { text }, buckets) }, { "x-tokens-charged": String(charged) });
    }
    return problem(404, "Not Found", "Caminho inexistente na API simulada");
  };
}
