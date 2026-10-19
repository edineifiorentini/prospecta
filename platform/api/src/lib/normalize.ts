import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/max";

/** Remove acentos, pontuação e espaços repetidos; minúsculas. */
export function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " e ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

const LEGAL_SUFFIXES = /\b(ltda|ltd|me|mei|epp|eireli|s a|sa|s s|ss|cia|comercio e servicos|comercio|servicos|inc|llc)\b/g;

/** Chave de nome para deduplicação (sem sufixos societários). */
export function normName(name: string): string {
  const f = fold(name).replace(LEGAL_SUFFIXES, " ").replace(/\s+/g, " ").trim();
  return f || fold(name);
}

export function normAddress(address?: string | null): string | null {
  if (!address) return null;
  const f = fold(address)
    .replace(/\b(rua|r|avenida|av|travessa|tv|alameda|al|rodovia|rod|estrada|est|praca|pca)\b/g, " ")
    .replace(/\b(brasil|brazil)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return f ? f.slice(0, 80) : null;
}

export type PhoneInfo = { e164: string; national: string; type?: string; isMobile: boolean; valid: boolean };

/** Normaliza telefone para E.164. Retorna null se não for possível interpretar. */
export function normalizePhone(raw?: string | null, defaultCountry: CountryCode = "BR"): PhoneInfo | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[^\d+]/g, "");
  if (cleaned.replace(/\D/g, "").length < 8) return null;
  const parsed = parsePhoneNumberFromString(cleaned.startsWith("+") ? cleaned : raw, defaultCountry);
  if (!parsed) return null;
  const type = parsed.getType();
  return {
    e164: parsed.number,
    national: parsed.formatNational(),
    type,
    isMobile: type === "MOBILE" || type === "FIXED_LINE_OR_MOBILE",
    valid: parsed.isValid(),
  };
}

/** Domínios que não identificam uma empresa (redes sociais, agregadores, encurtadores). */
const GENERIC_DOMAINS = new Set([
  "facebook.com", "instagram.com", "linkedin.com", "twitter.com", "x.com", "tiktok.com", "youtube.com", "youtu.be",
  "wa.me", "whatsapp.com", "api.whatsapp.com", "linktr.ee", "linktree.com", "google.com", "goo.gl", "g.page",
  "business.site", "sites.google.com", "bit.ly", "ifood.com.br", "booking.com", "tripadvisor.com", "tripadvisor.com.br",
  "doctoralia.com.br", "wixsite.com", "blogspot.com", "wordpress.com", "pinterest.com", "threads.net", "maps.app.goo.gl",
]);

export function hostOf(url?: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    return u.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function isGenericDomain(host: string) {
  return GENERIC_DOMAINS.has(host) || [...GENERIC_DOMAINS].some((d) => host.endsWith(`.${d}`));
}

/** Domínio próprio da empresa (null para redes sociais e agregadores). */
export function normDomain(url?: string | null): string | null {
  const host = hostOf(url);
  if (!host || isGenericDomain(host)) return null;
  return host;
}

/** Garante URL http(s) válida; descarta esquemas perigosos (javascript:, data:…). */
export function safeHttpUrl(raw?: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (!u.hostname.includes(".")) return null;
    u.hash = "";
    return u.toString();
  } catch {
    return null;
  }
}

const EMAIL_RE = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;
const EMAIL_JUNK = /(\.png|\.jpg|\.jpeg|\.gif|\.webp|\.svg|example\.|sentry|wixpress|@2x|domain\.com|email\.com|seudominio|yourdomain)/i;

export function normalizeEmail(raw?: string | null): string | null {
  if (!raw) return null;
  const e = raw.trim().toLowerCase().replace(/^mailto:/, "").split("?")[0]!;
  if (e.length > 254 || !EMAIL_RE.test(e) || EMAIL_JUNK.test(e)) return null;
  return e;
}

export function splitList(raw?: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(/[,;|\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export const uniq = <T>(arr: T[]) => [...new Set(arr)];
