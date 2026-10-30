import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/max";

/**
 * Análise de telefones para a inteligência comercial.
 *
 * - Normaliza números brasileiros e internacionais para E.164.
 * - Valida DDI e, no Brasil, o DDD contra a lista da Anatel.
 * - Classifica em celular, fixo, 0800 ou desconhecido pelo plano de numeração (não pelo uso real).
 * - WhatsApp só é "confirmado" quando a própria empresa o divulga (link wa.me no site) ou alguém
 *   o registra manualmente. Celular sem esse sinal NÃO vira WhatsApp, e fixo com WhatsApp é válido.
 * - Números repetidos (mesmo E.164 vindo de fontes ou canais diferentes) viram um único registro.
 */

/** DDDs em uso no Brasil (Anatel). */
export const BR_DDDS = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35, 37, 38, 41, 42, 43, 44, 45, 46, 47, 48, 49, 51, 53, 54, 55,
  61, 62, 63, 64, 65, 66, 67, 68, 69, 71, 73, 74, 75, 77, 79, 81, 82, 83, 84, 85, 86, 87, 88, 89, 91, 92, 93, 94, 95, 96, 97, 98, 99,
]);

export type PhoneKind = "MOBILE" | "FIXED" | "TOLL_FREE" | "UNKNOWN";
export type PhoneChannel = "PHONE" | "WHATSAPP";

export type PhoneInput = {
  raw: string;
  channel: PhoneChannel;
  source: string;
  sourceUrl?: string | null;
  observedAt?: Date | string | null;
  /** status do contato no Prospecta (INVALID é descartado) */
  status?: string | null;
};

export type PhoneOrigin = { channel: PhoneChannel; source: string; sourceUrl: string | null; observedAt: string | null };

export type AnalyzedPhone = {
  e164: string;
  national: string;
  countryCode: string;
  /** DDD (somente Brasil) */
  areaCode: string | null;
  kind: PhoneKind;
  /** CONFIRMED: divulgado pela empresa como WhatsApp ou registrado manualmente */
  whatsapp: "CONFIRMED" | "NOT_CONFIRMED";
  origins: PhoneOrigin[];
  /** quantidade de fontes distintas que mostram o mesmo número */
  sourceCount: number;
};

export type RejectedPhone = { raw: string; reason: string; source: string };

export type PhoneAnalysis = { phones: AnalyzedPhone[]; rejected: RejectedPhone[]; duplicatesMerged: number };

const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);

/** Normaliza um número. Retorna o motivo da recusa quando não é possível usar. */
export function parsePhone(raw: string, defaultCountry: CountryCode = "BR"): { ok: true; phone: Omit<AnalyzedPhone, "whatsapp" | "origins" | "sourceCount"> } | { ok: false; reason: string } {
  const cleaned = raw.trim().replace(/[^\d+]/g, "");
  const digits = cleaned.replace(/\D/g, "");
  if (digits.length < 8) return { ok: false, reason: "Número curto demais." };
  // "00" internacional e prefixo de operadora (0 + 2 dígitos) não entram no E.164
  const candidate = cleaned.startsWith("+") ? cleaned : cleaned.startsWith("00") ? `+${cleaned.slice(2)}` : raw;
  const parsed = parsePhoneNumberFromString(candidate, defaultCountry);
  if (!parsed) return { ok: false, reason: "Formato não reconhecido." };
  if (!parsed.isValid()) return { ok: false, reason: `Número inválido para o país +${parsed.countryCallingCode}.` };
  const nsn = parsed.nationalNumber as string;
  const countryCode = parsed.countryCallingCode as string;
  let areaCode: string | null = null;
  let kind: PhoneKind = "UNKNOWN";
  if (countryCode === "55") {
    if (/^0?800/.test(nsn) || parsed.getType() === "TOLL_FREE") kind = "TOLL_FREE";
    else {
      areaCode = nsn.slice(0, 2);
      if (!BR_DDDS.has(Number(areaCode))) return { ok: false, reason: `DDD ${areaCode} não existe.` };
      const local = nsn.slice(2);
      kind = local.length === 9 && local.startsWith("9") ? "MOBILE" : local.length === 8 && /^[2-5]/.test(local) ? "FIXED" : "UNKNOWN";
    }
  } else {
    const t = parsed.getType();
    kind = t === "MOBILE" ? "MOBILE" : t === "FIXED_LINE" ? "FIXED" : t === "TOLL_FREE" ? "TOLL_FREE" : "UNKNOWN";
  }
  return { ok: true, phone: { e164: parsed.number as string, national: parsed.formatNational(), countryCode, areaCode, kind } };
}

/** WhatsApp confirmado: link publicado pela empresa (fonte WEBSITE) ou registro manual. */
const confirmsWhatsapp = (p: PhoneInput) => p.channel === "WHATSAPP" && (p.source === "WEBSITE" || p.source === "MANUAL");

export function analyzePhones(inputs: PhoneInput[], defaultCountry: CountryCode = "BR"): PhoneAnalysis {
  const byE164 = new Map<string, AnalyzedPhone>();
  const rejected: RejectedPhone[] = [];
  let seen = 0;
  for (const input of inputs) {
    if (input.status === "INVALID") {
      rejected.push({ raw: input.raw, reason: "Marcado como inválido na verificação.", source: input.source });
      continue;
    }
    const r = parsePhone(input.raw, defaultCountry);
    if (!r.ok) {
      rejected.push({ raw: input.raw, reason: r.reason, source: input.source });
      continue;
    }
    seen++;
    const origin: PhoneOrigin = { channel: input.channel, source: input.source, sourceUrl: input.sourceUrl ?? null, observedAt: iso(input.observedAt) };
    const current = byE164.get(r.phone.e164);
    if (!current) {
      byE164.set(r.phone.e164, { ...r.phone, whatsapp: confirmsWhatsapp(input) ? "CONFIRMED" : "NOT_CONFIRMED", origins: [origin], sourceCount: 1 });
      continue;
    }
    if (!current.origins.some((o) => o.channel === origin.channel && o.source === origin.source && o.sourceUrl === origin.sourceUrl)) current.origins.push(origin);
    if (confirmsWhatsapp(input)) current.whatsapp = "CONFIRMED";
    current.sourceCount = new Set(current.origins.map((o) => o.source)).size;
  }
  // ordem estável: WhatsApp confirmado, celular, fixo; depois pelo número
  const rank = (p: AnalyzedPhone) => (p.whatsapp === "CONFIRMED" ? 0 : 1) * 10 + ["MOBILE", "FIXED", "TOLL_FREE", "UNKNOWN"].indexOf(p.kind);
  const phones = [...byE164.values()].sort((a, b) => rank(a) - rank(b) || a.e164.localeCompare(b.e164));
  return { phones, rejected, duplicatesMerged: seen - phones.length };
}
