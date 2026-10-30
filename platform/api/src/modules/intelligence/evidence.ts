import { fold, safeHttpUrl } from "../../lib/normalize.ts";
import { analyzePhones, type PhoneAnalysis, type PhoneInput } from "./phones.ts";
import { detectSegment, type SegmentMatch } from "./segments.ts";

/**
 * Coleta de evidências e checagem de qualidade dos dados de uma empresa.
 * Tudo aqui é determinístico: recebe um instantâneo dos dados e a data de referência.
 */

export type EvidenceKind = "OBSERVED" | "INFERRED";

export type Evidence = {
  /** chave única do sinal; o mesmo sinal nunca pontua duas vezes no mesmo indicador */
  key: string;
  label: string;
  kind: EvidenceKind;
  source: string;
  sourceUrl: string | null;
  observedAt: string | null;
};

export type CompanySnapshot = {
  id: string;
  name: string;
  category: string | null;
  categories: string[];
  city: string | null;
  state: string | null;
  address: string | null;
  website: string | null;
  cnpj: string | null;
  sourceUrl: string | null;
  rating: number | null;
  reviewCount: number | null;
  publicProfile: Record<string, unknown> | null;
  enrichmentStatus: string;
  lastEnrichedAt: Date | null;
  lastVerifiedAt: Date | null;
  collectedAt: Date;
  hasGoogleSource: boolean;
  contacts: { type: "EMAIL" | "PHONE" | "WHATSAPP"; value: string; normalizedValue: string; source: string; sourceUrl: string | null; status: string; collectedAt: Date; lastVerifiedAt: Date | null }[];
  websites: { url: string; finalUrl: string | null; isReachable: boolean | null; robotsAllowed: boolean | null; title: string | null; metaDescription: string | null; lastCheckedAt: Date | null }[];
  socialProfiles: { network: string; url: string; handle: string; status: string; source: string; sourceUrl: string | null; lastCheckedAt: Date | null; createdAt: Date }[];
  fieldSources: { field: string; value: string | null; source: string; status: string; observedAt: Date }[];
  /** resultado dos critérios da última auditoria digital concluída (se houver) */
  auditSignals: Record<string, string> | null;
  auditAt: Date | null;
  /** outras empresas da mesma conta que parecem ser a mesma */
  duplicateCandidates: { id: string; name: string; reason: string }[];
};

export type WebsiteState = "NONE" | "INVALID_URL" | "NOT_CHECKED" | "REACHABLE" | "BLOCKED" | "UNREACHABLE";

export type QualityIssue = { code: string; severity: "INFO" | "WARN"; message: string };

export type CompanyFacts = {
  evidence: Evidence[];
  phones: PhoneAnalysis;
  segment: SegmentMatch | null;
  website: { state: WebsiteState; url: string | null; checkedAt: string | null };
  emails: { value: string; source: string; sourceUrl: string | null }[];
  socials: { network: string; handle: string; url: string; confirmed: boolean; source: string }[];
  contradictions: { field: string; values: { value: string; source: string }[] }[];
  issues: QualityIssue[];
  lastVerification: string | null;
};

const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);

function websiteState(c: CompanySnapshot): CompanyFacts["website"] {
  if (!c.website) return { state: "NONE", url: null, checkedAt: null };
  const url = safeHttpUrl(c.website);
  if (!url) return { state: "INVALID_URL", url: c.website, checkedAt: null };
  const w = c.websites[0];
  if (!w || w.isReachable == null) return { state: "NOT_CHECKED", url, checkedAt: null };
  const checkedAt = iso(w.lastCheckedAt);
  if (w.robotsAllowed === false) return { state: "BLOCKED", url: w.finalUrl ?? url, checkedAt };
  return { state: w.isReachable ? "REACHABLE" : "UNREACHABLE", url: w.finalUrl ?? url, checkedAt };
}

/** Campos de valor único: duas fontes com valores diferentes são uma contradição. */
const SINGLE_VALUE_FIELDS = new Set(["city", "state", "cnpj", "postalCode", "legalName"]);

function findContradictions(c: CompanySnapshot): CompanyFacts["contradictions"] {
  const byField = new Map<string, Map<string, { value: string; source: string }>>();
  for (const f of c.fieldSources) {
    if (!SINGLE_VALUE_FIELDS.has(f.field) || !f.value?.trim() || f.status === "INVALID" || f.status === "ESTIMATED") continue;
    const key = f.field === "cnpj" ? f.value.replace(/\D/g, "") : fold(f.value);
    const values = byField.get(f.field) ?? new Map();
    if (!values.has(key)) values.set(key, { value: f.value.trim(), source: f.source });
    byField.set(f.field, values);
  }
  return [...byField.entries()]
    .filter(([, v]) => v.size > 1 && new Set([...v.values()].map((x) => x.source)).size > 1)
    .map(([field, v]) => ({ field, values: [...v.values()] }))
    .sort((a, b) => a.field.localeCompare(b.field));
}

const SOCIAL_LABEL: Record<string, string> = { INSTAGRAM: "Instagram", FACEBOOK: "Facebook", LINKEDIN: "LinkedIn", TIKTOK: "TikTok", YOUTUBE: "YouTube", X: "X", THREADS: "Threads", PINTEREST: "Pinterest" };
const SOURCE_LABEL: Record<string, string> = { GOOGLE_MAPS_SCRAPER: "ficha do Google Maps", WEBSITE: "site oficial", MANUAL: "registro manual", CSV_IMPORT: "importação", OSM_OVERPASS: "OpenStreetMap", BRASILAPI_CNPJ: "BrasilAPI (CNPJ)", SYSTEM: "Prospecta" };
export const sourceLabel = (s: string) => SOURCE_LABEL[s] ?? s;

export function collectFacts(c: CompanySnapshot): CompanyFacts {
  const evidence: Evidence[] = [];
  const add = (e: Evidence) => {
    if (!evidence.some((x) => x.key === e.key)) evidence.push(e);
  };
  const issues: QualityIssue[] = [];
  const googleAt = iso(c.collectedAt);

  // ── Segmento ──
  const segment = detectSegment(c);
  if (segment) {
    add({
      key: "segment",
      label: `Segmento ${segment.segment.label} identificado pelo termo "${segment.matchedTerm}" ${segment.field === "category" ? "na categoria" : "no nome"}`,
      kind: segment.field === "category" ? "OBSERVED" : "INFERRED",
      source: c.hasGoogleSource ? "GOOGLE_MAPS_SCRAPER" : "SYSTEM",
      sourceUrl: c.sourceUrl,
      observedAt: googleAt,
    });
  }

  // ── Telefones e WhatsApp ──
  const phoneInputs: PhoneInput[] = c.contacts
    .filter((x) => x.type === "PHONE" || x.type === "WHATSAPP")
    .map((x) => ({ raw: x.normalizedValue || x.value, channel: x.type as "PHONE" | "WHATSAPP", source: x.source, sourceUrl: x.sourceUrl, observedAt: x.lastVerifiedAt ?? x.collectedAt, status: x.status }));
  const phones = analyzePhones(phoneInputs);
  for (const p of phones.phones) {
    const kindLabel = p.kind === "MOBILE" ? "celular" : p.kind === "FIXED" ? "fixo" : p.kind === "TOLL_FREE" ? "0800" : "tipo não identificado";
    const first = p.origins[0]!;
    const waVia = p.origins.some((o) => o.channel === "WHATSAPP" && o.source === "WEBSITE") ? ", WhatsApp divulgado no site oficial" : ", WhatsApp registrado manualmente";
    add({
      key: `phone:${p.e164}`,
      label: `Telefone ${p.national} (${kindLabel}${p.whatsapp === "CONFIRMED" ? waVia : ""}) em ${p.sourceCount} fonte(s)`,
      kind: "OBSERVED",
      source: first.source,
      sourceUrl: p.origins.find((o) => o.channel === "WHATSAPP")?.sourceUrl ?? first.sourceUrl,
      observedAt: first.observedAt,
    });
    // a concordância entre fontes é um sinal próprio (confiabilidade), distinto do número em si
    if (p.sourceCount >= 2) {
      add({ key: `cross:${p.e164}`, label: `O telefone ${p.national} aparece em ${p.sourceCount} fontes: ${[...new Set(p.origins.map((o) => sourceLabel(o.source)))].join(", ")}`, kind: "OBSERVED", source: "SYSTEM", sourceUrl: null, observedAt: p.origins.map((o) => o.observedAt).filter(Boolean).sort().at(-1) ?? null });
    }
  }
  if (phones.rejected.length) issues.push({ code: "phone.invalid", severity: "WARN", message: `${phones.rejected.length} telefone(s) descartado(s): ${[...new Set(phones.rejected.map((r) => r.reason))].join(" ")}` });
  if (phones.duplicatesMerged > 0) issues.push({ code: "phone.duplicates", severity: "INFO", message: `${phones.duplicatesMerged} registro(s) repetido(s) do mesmo número foram consolidados.` });
  const mobileNoWa = phones.phones.filter((p) => p.kind === "MOBILE" && p.whatsapp === "NOT_CONFIRMED").length;
  if (mobileNoWa) issues.push({ code: "phone.whatsapp_unconfirmed", severity: "INFO", message: `${mobileNoWa} celular(es) sem WhatsApp confirmado. Ter celular não prova que a empresa atende pelo WhatsApp.` });

  // ── E-mails ──
  const emails = c.contacts.filter((x) => x.type === "EMAIL" && x.status !== "INVALID").map((x) => ({ value: x.normalizedValue, source: x.source, sourceUrl: x.sourceUrl }));
  if (emails.length) add({ key: "email", label: `${emails.length} e-mail(s) comercial(is) publicado(s)`, kind: "OBSERVED", source: emails[0]!.source, sourceUrl: emails[0]!.sourceUrl, observedAt: null });

  // ── Site ──
  const website = websiteState(c);
  const siteLabel: Record<WebsiteState, string> = {
    NONE: "Nenhum site informado nas fontes",
    INVALID_URL: "Endereço de site inválido",
    NOT_CHECKED: "Site informado, ainda não visitado",
    REACHABLE: "Site oficial no ar",
    BLOCKED: "Site bloqueia a leitura automática (robots.txt): não foi analisado",
    UNREACHABLE: "Site não respondeu na última visita",
  };
  add({ key: "website", label: siteLabel[website.state], kind: "OBSERVED", source: website.state === "NONE" ? (c.hasGoogleSource ? "GOOGLE_MAPS_SCRAPER" : "SYSTEM") : "WEBSITE", sourceUrl: website.url, observedAt: website.checkedAt });
  if (website.state === "INVALID_URL") issues.push({ code: "website.invalid", severity: "WARN", message: "O endereço do site informado não é uma URL válida." });
  if (website.state === "BLOCKED" || website.state === "UNREACHABLE") issues.push({ code: "website.unavailable", severity: "INFO", message: "Site indisponível ou bloqueado para leitura. Isso não reduz a pontuação; só deixa critérios sem avaliação." });
  const home = c.websites[0];
  if (website.state === "REACHABLE" && home?.title) add({ key: "website.title", label: `Título do site: "${home.title.slice(0, 120)}"`, kind: "OBSERVED", source: "WEBSITE", sourceUrl: website.url, observedAt: website.checkedAt });

  // ── Redes sociais ──
  const socials = c.socialProfiles
    .filter((s) => s.status !== "INVALID" && s.network !== "WHATSAPP")
    .map((s) => ({ network: s.network, handle: s.handle, url: s.url, confirmed: s.status === "VERIFIED", source: s.source }));
  for (const s of c.socialProfiles.filter((x) => x.status !== "INVALID" && x.network !== "WHATSAPP")) {
    add({
      key: `social:${s.network}`,
      label: `${SOCIAL_LABEL[s.network] ?? s.network} @${s.handle}${s.status === "VERIFIED" ? " (vínculo confirmado)" : " (vínculo não confirmado)"}`,
      kind: s.status === "VERIFIED" ? "OBSERVED" : "INFERRED",
      source: s.source,
      sourceUrl: s.sourceUrl ?? s.url,
      observedAt: iso(s.lastCheckedAt ?? s.createdAt),
    });
  }

  // ── Ficha pública do Google ──
  if (c.reviewCount != null) add({ key: "gbp.reviews", label: `${c.reviewCount} avaliações públicas${c.rating != null ? `, nota ${c.rating.toFixed(1)}` : ""}`, kind: "OBSERVED", source: "GOOGLE_MAPS_SCRAPER", sourceUrl: c.sourceUrl, observedAt: googleAt });
  const pp = c.publicProfile ?? {};
  if (pp.reservationsLink === true) add({ key: "gbp.reservations", label: "Ficha do Google com link de agendamento/reserva", kind: "OBSERVED", source: "GOOGLE_MAPS_SCRAPER", sourceUrl: c.sourceUrl, observedAt: googleAt });
  if (pp.orderOnlineLink === true) add({ key: "gbp.order", label: "Ficha do Google com link de pedido on-line", kind: "OBSERVED", source: "GOOGLE_MAPS_SCRAPER", sourceUrl: c.sourceUrl, observedAt: googleAt });

  // ── Auditoria digital (se houver) ──
  const audit = c.auditSignals ?? {};
  const auditAt = iso(c.auditAt);
  if (audit["site.contact_page"] === "PASS") add({ key: "audit.contact_page", label: "Página de contato no site", kind: "OBSERVED", source: "WEBSITE", sourceUrl: website.url, observedAt: auditAt });
  if (audit["site.contact_buttons"] === "PASS") add({ key: "audit.contact_buttons", label: "Botões de contato (telefone, WhatsApp, e-mail ou formulário) no site", kind: "OBSERVED", source: "WEBSITE", sourceUrl: website.url, observedAt: auditAt });
  if (audit["site.cta"] === "PASS") add({ key: "audit.cta", label: "Chamada para ação comercial no site", kind: "OBSERVED", source: "WEBSITE", sourceUrl: website.url, observedAt: auditAt });

  // ── Localização ──
  const cityField = c.fieldSources.find((f) => f.field === "city");
  if (c.city) add({ key: "city", label: `Cidade: ${c.city}${c.state ? `/${c.state}` : ""}`, kind: cityField?.status === "ESTIMATED" ? "INFERRED" : "OBSERVED", source: cityField?.source ?? (c.hasGoogleSource ? "GOOGLE_MAPS_SCRAPER" : "SYSTEM"), sourceUrl: c.sourceUrl, observedAt: iso(cityField?.observedAt) ?? googleAt });

  // ── Qualidade ──
  const contradictions = findContradictions(c);
  for (const k of contradictions) issues.push({ code: `contradiction.${k.field}`, severity: "WARN", message: `Fontes discordam sobre ${k.field}: ${k.values.map((v) => `"${v.value}" (${sourceLabel(v.source)})`).join(" × ")}.` });
  const missing = [!c.category && "categoria", !c.city && "cidade", !phones.phones.length && !emails.length && "contato válido"].filter(Boolean);
  if (missing.length) issues.push({ code: "record.incomplete", severity: "WARN", message: `Cadastro incompleto: falta ${missing.join(", ")}.` });
  for (const d of c.duplicateCandidates) issues.push({ code: "record.duplicate", severity: "WARN", message: `Possível duplicidade com "${d.name}" (${d.reason}).` });
  const dates = [c.lastVerifiedAt, c.lastEnrichedAt, c.collectedAt].filter((d): d is Date => !!d).map((d) => d.getTime());
  const lastVerification = dates.length ? new Date(Math.max(...dates)).toISOString() : null;

  return { evidence, phones, segment, website, emails, socials, contradictions, issues, lastVerification };
}
