import { load, type CheerioAPI } from "cheerio";
import { hostOf, normalizeEmail, normalizePhone, uniq } from "../../lib/normalize.ts";
import { parseSocialUrl, type ParsedSocial } from "./social.ts";

export type PageExtraction = {
  url: string;
  title: string | null;
  metaDescription: string | null;
  lang: string | null;
  canonical: string | null;
  viewport: boolean;
  h1: string[];
  h2Count: number;
  og: Record<string, string>;
  emails: { value: string; via: "mailto" | "text" | "jsonld" }[];
  phones: { e164: string; raw: string; via: "tel" | "text" | "jsonld"; mobile: boolean }[];
  whatsapp: { e164: string; url: string }[];
  socials: (ParsedSocial & { anchorText: string; context: string })[];
  jsonLd: { types: string[]; name?: string; legalName?: string; telephone?: string[]; email?: string[]; sameAs?: string[]; address?: Record<string, string>; taxId?: string };
  cnpjs: string[];
  internalLinks: { url: string; text: string }[];
  forms: number;
  ctas: string[];
  imagesWithoutAlt: number;
  images: number;
  hasContactForm: boolean;
  wordCount: number;
  textSnippet: string;
  generator: string | null;
};

const EMAIL_IN_TEXT = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
// telefones brasileiros com DDD: (19) 3325-7728, 19 99120-0967, +55 19 3325 7728, 0800 …
const PHONE_IN_TEXT = /(?:\+?55[\s.-]?)?\(?\b[1-9]{2}\)?[\s.-]?(?:9[\s.-]?)?\d{4}[\s.-]?\d{4}\b|\b0800[\s.-]?\d{3}[\s.-]?\d{4}\b/g;
const CNPJ_RE = /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g;
const CTA_RE = /(fale conosco|entre em contato|contato|agende|agendar|marque (sua|uma) consulta|solicite|or[cç]amento|comprar|compre|whatsapp|ligue|reserve|reservar|matricule|assine|cadastre|saiba mais|pe[cç]a)/i;

/** Valida dígitos verificadores do CNPJ. */
export function isValidCnpj(raw: string): boolean {
  const c = raw.replace(/\D/g, "");
  if (c.length !== 14 || /^(\d)\1+$/.test(c)) return false;
  const calc = (len: number) => {
    const weights = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((acc, w, i) => acc + Number(c[i]) * w, 0);
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === Number(c[12]) && calc(13) === Number(c[13]);
}

function collectJsonLd($: CheerioAPI) {
  const out: PageExtraction["jsonLd"] = { types: [] };
  const visit = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(visit);
    const o = node as Record<string, unknown>;
    if (o["@graph"]) visit(o["@graph"]);
    const types = ([] as unknown[]).concat(o["@type"] ?? []).map(String);
    if (types.length) out.types.push(...types);
    const isOrg = types.some((t) => /Organization|LocalBusiness|Store|Restaurant|Dentist|MedicalBusiness|ProfessionalService|Corporation|Physician|Clinic|LegalService|AutomotiveBusiness|HealthAndBeautyBusiness|SportsActivityLocation|FoodEstablishment|LodgingBusiness/i.test(t));
    if (isOrg) {
      if (typeof o.name === "string" && !out.name) out.name = o.name;
      if (typeof o.legalName === "string") out.legalName = o.legalName;
      const tel = ([] as unknown[]).concat(o.telephone ?? []).map(String).filter(Boolean);
      if (tel.length) out.telephone = uniq([...(out.telephone ?? []), ...tel]);
      const em = ([] as unknown[]).concat(o.email ?? []).map(String).filter(Boolean);
      if (em.length) out.email = uniq([...(out.email ?? []), ...em]);
      const same = ([] as unknown[]).concat(o.sameAs ?? []).map(String).filter(Boolean);
      if (same.length) out.sameAs = uniq([...(out.sameAs ?? []), ...same]);
      if (o.address && typeof o.address === "object" && !Array.isArray(o.address)) {
        out.address = Object.fromEntries(Object.entries(o.address as Record<string, unknown>).filter(([, v]) => typeof v === "string")) as Record<string, string>;
      }
      for (const k of ["taxID", "vatID", "identifier"]) if (typeof o[k] === "string") out.taxId = o[k] as string;
    }
    for (const v of Object.values(o)) if (v && typeof v === "object") visit(v);
  };
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text().trim();
    if (!raw || raw.length > 200_000) return;
    try {
      visit(JSON.parse(raw));
    } catch {
      /* JSON-LD inválido é ignorado */
    }
  });
  out.types = uniq(out.types);
  return out;
}

export function extractPage(html: string, pageUrl: string): PageExtraction {
  const $ = load(html);
  const base = new URL(pageUrl);
  const siteHost = hostOf(pageUrl);
  const jsonLd = collectJsonLd($);

  // texto visível (sem scripts/estilos) para buscas por regex
  $("script, style, noscript, template, svg").remove();
  const text = $("body").text().replace(/\s+/g, " ").trim();

  const emails: PageExtraction["emails"] = [];
  const phones: PageExtraction["phones"] = [];
  const whatsapp: PageExtraction["whatsapp"] = [];
  const socials: PageExtraction["socials"] = [];
  const internalLinks: PageExtraction["internalLinks"] = [];
  const ctas = new Set<string>();

  $("a[href]").each((_, el) => {
    const hrefRaw = ($(el).attr("href") ?? "").trim();
    const anchorText = $(el).text().replace(/\s+/g, " ").trim().slice(0, 80);
    if (!hrefRaw || hrefRaw.startsWith("#") || /^javascript:/i.test(hrefRaw)) return;
    if (/^mailto:/i.test(hrefRaw)) {
      const e = normalizeEmail(decodeURIComponent(hrefRaw.slice(7)));
      if (e) emails.push({ value: e, via: "mailto" });
      return;
    }
    if (/^tel:/i.test(hrefRaw)) {
      const p = normalizePhone(decodeURIComponent(hrefRaw.slice(4)));
      if (p?.valid) phones.push({ e164: p.e164, raw: hrefRaw.slice(4), via: "tel", mobile: p.isMobile });
      return;
    }
    let abs: URL;
    try {
      abs = new URL(hrefRaw, base);
    } catch {
      return;
    }
    if (abs.protocol !== "http:" && abs.protocol !== "https:") return;
    const social = parseSocialUrl(abs.toString());
    if (social) {
      const parentText = $(el).parent().text().replace(/\s+/g, " ").trim().slice(0, 160);
      if (social.network === "WHATSAPP") {
        const p = normalizePhone(`+${social.handle}`);
        if (p?.valid) whatsapp.push({ e164: p.e164, url: social.url });
      } else socials.push({ ...social, anchorText, context: parentText });
      return;
    }
    if (hostOf(abs.toString()) === siteHost) {
      abs.hash = "";
      internalLinks.push({ url: abs.toString(), text: anchorText.toLowerCase() });
    }
    if (CTA_RE.test(anchorText)) ctas.add(anchorText.slice(0, 40));
  });
  $("button, input[type=submit]").each((_, el) => {
    const t = ($(el).text() || $(el).attr("value") || "").replace(/\s+/g, " ").trim();
    if (t && CTA_RE.test(t)) ctas.add(t.slice(0, 40));
  });

  for (const m of text.match(EMAIL_IN_TEXT) ?? []) {
    const e = normalizeEmail(m);
    if (e) emails.push({ value: e, via: "text" });
  }
  for (const m of text.match(PHONE_IN_TEXT) ?? []) {
    const p = normalizePhone(m);
    if (p?.valid) phones.push({ e164: p.e164, raw: m, via: "text", mobile: p.isMobile });
  }
  for (const e of jsonLd.email ?? []) {
    const v = normalizeEmail(e);
    if (v) emails.push({ value: v, via: "jsonld" });
  }
  for (const t of jsonLd.telephone ?? []) {
    const p = normalizePhone(t);
    if (p?.valid) phones.push({ e164: p.e164, raw: t, via: "jsonld", mobile: p.isMobile });
  }
  for (const s of jsonLd.sameAs ?? []) {
    const social = parseSocialUrl(s);
    if (social && social.network !== "WHATSAPP") socials.push({ ...social, anchorText: "schema.org sameAs", context: "" });
  }

  const cnpjs = uniq([...(text.match(CNPJ_RE) ?? []), ...(jsonLd.taxId ? [jsonLd.taxId] : [])].map((c) => c.replace(/\D/g, "")).filter(isValidCnpj));

  const og: Record<string, string> = {};
  $('meta[property^="og:"]').each((_, el) => {
    const k = $(el).attr("property");
    const v = $(el).attr("content");
    if (k && v) og[k] = v.slice(0, 300);
  });
  const images = $("img").length;
  const imagesWithoutAlt = $("img").filter((_, el) => !($(el).attr("alt") ?? "").trim()).length;
  const forms = $("form").length;
  const hasContactForm = $("form").toArray().some((f) => $(f).find('input[type="email"], textarea, input[name*="mail" i], input[name*="tel" i], input[name*="fone" i]').length > 0);
  const paragraphs = $("main p, article p, section p, p")
    .toArray()
    .map((p) => $(p).text().replace(/\s+/g, " ").trim())
    .filter((t) => t.length > 60);

  const dedupe = <T>(arr: T[], key: (x: T) => string) => {
    const seen = new Set<string>();
    return arr.filter((x) => (seen.has(key(x)) ? false : (seen.add(key(x)), true)));
  };

  return {
    url: pageUrl,
    title: $("title").first().text().trim().slice(0, 300) || null,
    metaDescription: $('meta[name="description"]').attr("content")?.trim().slice(0, 500) || null,
    lang: $("html").attr("lang") ?? null,
    canonical: $('link[rel="canonical"]').attr("href") ?? null,
    viewport: $('meta[name="viewport"]').length > 0,
    h1: $("h1")
      .toArray()
      .map((h) => $(h).text().replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .slice(0, 5),
    h2Count: $("h2").length,
    og,
    emails: dedupe(emails, (e) => e.value),
    phones: dedupe(phones, (p) => p.e164),
    whatsapp: dedupe(whatsapp, (w) => w.e164),
    socials: dedupe(socials, (s) => `${s.network}:${s.handle}`),
    jsonLd,
    cnpjs,
    internalLinks: dedupe(internalLinks, (l) => l.url).slice(0, 300),
    forms,
    ctas: [...ctas].slice(0, 15),
    imagesWithoutAlt,
    images,
    hasContactForm,
    wordCount: text ? text.split(" ").length : 0,
    textSnippet: paragraphs.slice(0, 3).join(" ").slice(0, 600),
    generator: $('meta[name="generator"]').attr("content")?.slice(0, 80) ?? null,
  };
}

const PRIORITY_PATTERNS = [
  /contat|contact|fale-?conosco|atendimento|orcamento|orçamento/i,
  /sobre|about|quem-?somos|empresa|institucional|nossa-?historia|a-clinica|a-empresa/i,
  /servic|service|tratamento|especialidade|produto|product|solucoes|soluções/i,
  /onde-?estamos|localiza|endereco|unidades|location/i,
];

/** Escolhe as páginas mais úteis (Contato, Sobre, Serviços, Localização) a partir dos links internos. */
export function pickPriorityLinks(links: { url: string; text: string }[], max: number): string[] {
  const picked: string[] = [];
  for (const re of PRIORITY_PATTERNS) {
    const hit = links.find((l) => !picked.includes(l.url) && (re.test(new URL(l.url).pathname) || re.test(l.text)) && !/\.(pdf|jpg|jpeg|png|zip|docx?)$/i.test(l.url));
    if (hit) picked.push(hit.url);
    if (picked.length >= max) break;
  }
  return picked;
}

/** Indício de página que só renderiza com JavaScript (SPA vazia). */
export function looksJsRendered(html: string, ex: PageExtraction) {
  return ex.wordCount < 40 && /<div id="(root|app|__next|__nuxt)"|ng-version|data-reactroot|window\.__INITIAL_STATE__|<noscript>[^<]*enable javascript/i.test(html);
}
