import { runEconodataSearch } from "../company-data/search.ts";
import type { DiscoveryAdapter } from "./types.ts";

/**
 * Econodata como fonte de busca: segmentação da base de empresas (CNPJ) por cidade, palavra-chave, CNAE e porte.
 * Disponível por conta: só com os dados empresariais ligados e a chave da própria conta (ou o simulado fora de
 * produção) — ver search/routes.ts. Consome tokens da Econodata por empresa trazida.
 */
export const econodataAdapter: DiscoveryAdapter = {
  id: "ECONODATA",
  label: "Econodata (base de empresas)",
  license: "Dados licenciados pela Econodata e cobrados em tokens da sua conta. Use conforme o contrato e a LGPD.",
  warning: "Cada empresa trazida consome tokens. Confira a prévia de quantidade e custo antes de buscar.",
  available: async () => ({ ok: true }),
  run: (ctx) => runEconodataSearch(ctx),
};
