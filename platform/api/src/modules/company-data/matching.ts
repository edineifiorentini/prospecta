import { fold } from "../../lib/normalize.ts";
import { cnpjDigits } from "./cnpj.ts";
import type { EconodataMatchItem } from "./econodata/client.ts";
import type { MatchCandidate } from "./types.ts";

/**
 * Decide se uma correspondência devolvida pelo fornecedor pode ser vinculada sozinha.
 * Regra de ouro: nunca atribuir os dados de uma empresa a outra por semelhança de nome.
 * Vínculo automático só quando TODAS valem:
 * 1. o fornecedor casou por identificador forte (CNPJ, site, telefone ou e-mail), não só por nome/UF;
 * 2. a confiança do melhor candidato atinge o mínimo da conta;
 * 3. não há outro candidato com confiança parecida (diferença < 0,10);
 * 4. o fornecedor entregou o cadastro do melhor candidato (ele só faz isso quando está confiante);
 * 5. UF e cidade do cadastro batem com as da empresa, quando os dois lados informam.
 * Em qualquer outro caso, os candidatos ficam guardados para uma pessoa confirmar.
 */

const STRONG = new Set(["cnpj", "site", "telefone", "email"]);
const AMBIGUITY_GAP = 0.1;

export type MatchDecision =
  | { action: "LINK"; cnpj: string; confidence: number; matchedBy: string[]; item: EconodataMatchItem }
  | { action: "ASK"; reason: string; candidates: MatchCandidate[] }
  | { action: "NOT_FOUND" };

export const toCandidate = (i: EconodataMatchItem): MatchCandidate => ({ cnpj: cnpjDigits(i.cnpj), legalName: i.razaoSocial, tradeName: i.nomeFantasia, confidence: i.confianca, matchedBy: i.correspondidoEm });

const sameText = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && fold(a) === fold(b);

export function decideMatch(company: { city: string | null; state: string | null }, items: EconodataMatchItem[], minConfidence: number): MatchDecision {
  if (!items.length) return { action: "NOT_FOUND" };
  const candidates = items.map(toCandidate);
  const best = items[0]!;
  const ask = (reason: string): MatchDecision => ({ action: "ASK", reason, candidates });

  if (!best.correspondidoEm.some((m) => STRONG.has(m))) return ask("A correspondência foi só pelo nome (e UF). Confirme qual empresa é antes de enriquecer.");
  if (best.confianca < minConfidence) return ask(`Confiança ${Math.round(best.confianca * 100)}% abaixo do mínimo da conta (${Math.round(minConfidence * 100)}%).`);
  const second = items[1];
  if (second && best.confianca - second.confianca < AMBIGUITY_GAP) return ask("Há mais de um candidato com confiança parecida.");
  if (!best.empresa?.cadastro) return ask("O fornecedor não confirmou o melhor candidato. Confirme manualmente.");

  const reg = best.empresa.cadastro;
  const regState = reg.endereco?.uf ?? reg.uf ?? null;
  const regCity = reg.endereco?.cidade ?? reg.cidade ?? null;
  if (company.state && regState && !sameText(company.state, regState)) return ask(`O cadastro encontrado é de ${regState}, e a empresa está em ${company.state}.`);
  if (company.city && regCity && !sameText(company.city, regCity)) return ask(`O cadastro encontrado é de ${regCity}, e a empresa está em ${company.city}.`);

  return { action: "LINK", cnpj: cnpjDigits(best.cnpj), confidence: best.confianca, matchedBy: best.correspondidoEm, item: best };
}

/** Avisos (sem bloquear) quando a empresa já tinha CNPJ e o cadastro aponta outra localização. */
export function locationWarnings(company: { city: string | null; state: string | null }, reg: { city: string | null; state: string | null } | null): string[] {
  if (!reg) return [];
  const out: string[] = [];
  if (company.state && reg.state && !sameText(company.state, reg.state)) out.push(`O cadastro do CNPJ é de ${reg.state}, e a empresa está em ${company.state}: pode ser outra unidade.`);
  else if (company.city && reg.city && !sameText(company.city, reg.city)) out.push(`O cadastro do CNPJ é de ${reg.city}, e a empresa está em ${company.city}: pode ser outra unidade.`);
  return out;
}
