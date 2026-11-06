import { describe, expect, it } from "vitest";
import { econodataFilters, searchBuckets, toDiscovered, ufOf } from "../../src/modules/company-data/search.ts";
import { normalizeEconodata } from "../../src/modules/company-data/econodata/normalize.ts";
import { defaultDataEnrichmentSettings } from "../../src/modules/orgs/settings.ts";
import { searchParamsSchema } from "../../src/modules/sources/types.ts";

const params = (extra: Record<string, unknown> = {}) => searchParamsSchema.parse({ provider: "ECONODATA", keyword: " padaria ", city: "Umuarama", state: "Paraná", ...extra });

describe("busca na Econodata: filtros e mapeamento", () => {
  it("UF por nome ou sigla", () => {
    expect(ufOf("Paraná")).toBe("PR");
    expect(ufOf("sp")).toBe("SP");
    expect(ufOf("São Paulo")).toBe("SP");
    expect(ufOf("Atlântida")).toBeNull();
    expect(ufOf(undefined)).toBeNull();
  });

  it("parâmetros da tela viram só filtros do contrato público", () => {
    expect(econodataFilters(params())).toEqual({
      situacao: ["ATIVA"],
      uf: ["PR"],
      cidade: ["Umuarama"],
      palavrasChave: { incluir: ["padaria"], em: ["NOME_EMPRESA", "PRODUTOS_SERVICOS"] },
    });
    const f = econodataFilters(params({ econodata: { cnaes: ["1091-1/02", "4721"], sizes: ["MICRO"], keywordScope: ["NOME_EMPRESA"], onlyWithPhone: true, activeOnly: false } }));
    expect(f).toMatchObject({ cnaePrimario: ["1091-1/02", "4721"], porte: ["MICRO"], comTelefones: true, palavrasChave: { em: ["NOME_EMPRESA"] } });
    expect(f.situacao).toBeUndefined();
  });

  it("blocos pagos só os liberados na conta (contatos ficam de fora por padrão)", () => {
    const e = params().econodata ?? { buckets: ["cadastro"] };
    expect(searchBuckets(defaultDataEnrichmentSettings, { ...params({ econodata: { buckets: ["cadastro", "estrategico"] } }).econodata! })).toEqual(["cadastro", "estrategico"]);
    expect(() => searchBuckets(defaultDataEnrichmentSettings, { ...params({ econodata: { buckets: ["cadastro", "contatosBasicos"] } }).econodata! })).toThrow();
    expect(e.buckets).toEqual(["cadastro"]);
  });

  it("empresa da Econodata vira registro de descoberta sem inventar campos", () => {
    const emp = {
      cnpj: "11.222.333/0001-81",
      cadastro: { razaoSocial: "PADARIA EXEMPLO LTDA", nomeFantasia: "Padaria Exemplo", cidade: "Umuarama", uf: "PR", cnaePrimario: { codigo: "C-1091-1/02", descricao: "Fabricação de produtos de panificação" }, endereco: { logradouro: "Rua A, 10", bairro: "Centro", cidade: "Umuarama", uf: "PR", cep: "87500-000" } },
      contatosBasicos: { telefones: [{ numero: "4436221234" }], emailsPublicos: [{ email: "contato@padariaexemplo.com.br" }], emailReceita: "contador@escritorio.com.br" },
    };
    const profile = normalizeEconodata(emp, { provider: "econodata-mock", simulated: true, fetchedAt: new Date().toISOString(), buckets: ["cadastro", "contatosBasicos"] });
    const d = toDiscovered(emp, profile);
    expect(d).toMatchObject({ name: "Padaria Exemplo", legalName: "PADARIA EXEMPLO LTDA", cnpj: "11222333000181", city: "Umuarama", state: "PR", postalCode: "87500-000", category: "Fabricação de produtos de panificação" });
    expect(d.phones).toEqual(["4436221234"]);
    // o e-mail da Receita costuma ser do contador: só e-mails públicos ou validados entram
    expect(d.emails).toEqual(["contato@padariaexemplo.com.br"]);
    expect(d.website ?? null).toBeNull();
    expect(d.raw).toEqual({ provider: "econodata-mock", cnpj: "11222333000181" });
    const bare = toDiscovered({ cnpj: "11.222.333/0001-81" }, profile);
    expect(bare).toMatchObject({ name: "11.222.333/0001-81", phones: [], emails: [], city: null });
  });
});
