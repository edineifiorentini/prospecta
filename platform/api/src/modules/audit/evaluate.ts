import type { Company, Contact, SocialProfile } from "../../lib/prisma.ts";
import { fold } from "../../lib/normalize.ts";
import type { CrawlResult } from "../enrichment/crawler.ts";
import { nameTokens } from "../companies/dedupe.ts";
import type { Evaluation } from "./scoring.ts";

export type LighthouseSummary = {
  performance: number | null;
  accessibility: number | null;
  bestPractices: number | null;
  seo: number | null;
  lcpMs: number | null;
  cls: number | null;
  tbtMs: number | null;
  fcpMs: number | null;
  formFactor: "mobile";
  fetchedAt: string;
  finalUrl: string;
};

export type AuditContext = {
  company: Company & { contacts: Contact[]; socialProfiles: SocialProfile[]; hasGoogleSource: boolean };
  crawl: CrawlResult | null;
  lighthouse: LighthouseSummary | null;
  brokenLinks: { checked: number; broken: { url: string; status: number | null }[] } | null;
  now: Date;
};

const pass = (key: string, detail?: string, value?: unknown, url?: string | null): Evaluation => ({ key, result: "PASS", detail, value, url });
const fail = (key: string, detail?: string, value?: unknown, url?: string | null): Evaluation => ({ key, result: "FAIL", detail, value, url });
const warn = (key: string, detail?: string, value?: unknown, url?: string | null): Evaluation => ({ key, result: "WARN", detail, value, url });
const na = (key: string, detail: string): Evaluation => ({ key, result: "NOT_EVALUATED", detail });
const pct = (v: number) => `${Math.round(v * 100)}`;

export function evaluate(ctx: AuditContext): Evaluation[] {
  const { company: c, crawl, lighthouse: lh, brokenLinks } = ctx;
  const out: Evaluation[] = [];
  const valid = (t: Contact["type"]) => c.contacts.filter((x) => x.type === t && x.status !== "INVALID");
  const phones = [...valid("PHONE"), ...valid("WHATSAPP")];
  const emails = valid("EMAIL");
  const socials = c.socialProfiles.filter((s) => s.status !== "INVALID");
  const verifiedSocials = socials.filter((s) => s.status === "VERIFIED");
  const home = crawl?.pages[0] ?? null;
  const pages = crawl?.pages ?? [];
  const siteChecked = !!crawl && crawl.reachable && !crawl.blockedReason;
  const sourceUrl = c.sourceUrl;

  // ── Qualidade dos dados ──
  out.push(pass("dq.name", c.name));
  out.push(c.category ? pass("dq.category", c.category) : fail("dq.category", "Nenhuma fonte informou a categoria."));
  out.push(c.address ? pass("dq.address", c.address) : fail("dq.address", "Endereço não informado pelas fontes."));
  out.push(c.city ? (c.osmId && !c.address ? warn("dq.city", "Cidade estimada a partir da área pesquisada.") : pass("dq.city", c.city)) : fail("dq.city", "Cidade desconhecida."));
  out.push(phones.length ? pass("dq.phone", `${phones.length} telefone(s) válido(s)`) : fail("dq.phone", "Nenhum telefone válido encontrado."));
  out.push(phones.length ? (phones.some((p) => p.status === "VERIFIED") ? pass("dq.phone_verified", "Confirmado em mais de uma fonte ou no site oficial") : warn("dq.phone_verified", "Telefone vindo de uma única fonte.")) : na("dq.phone_verified", "Sem telefone para confirmar."));
  out.push(emails.length ? pass("dq.email", emails.map((e) => e.normalizedValue).join(", ")) : fail("dq.email", "Nenhum e-mail comercial encontrado nas fontes consultadas."));
  const mx = emails.map((e) => (e.verification as Record<string, unknown> | null)?.mx);
  out.push(!emails.length ? (c.contacts.some((x) => x.type === "EMAIL") ? fail("dq.email_mx", "E-mail(s) encontrado(s), mas o domínio não aceita mensagens.") : na("dq.email_mx", "Sem e-mail para verificar.")) : mx.some((m) => m === true) ? pass("dq.email_mx", "MX encontrado (não garante entrega)") : mx.every((m) => m == null) ? na("dq.email_mx", "MX ainda não verificado.") : fail("dq.email_mx", "Domínio sem MX."));
  out.push(!c.website ? fail("dq.website", "Sem site informado.") : siteChecked ? pass("dq.website", crawl!.finalUrl ?? c.website, undefined, crawl!.finalUrl) : crawl ? warn("dq.website", crawl.blockedReason ?? "Site informado, mas não respondeu.") : warn("dq.website", "Site informado, ainda não verificado."));
  out.push(verifiedSocials.length ? pass("dq.social", verifiedSocials.map((s) => `${s.network}:${s.handle}`).join(", ")) : socials.length ? warn("dq.social", "Perfis encontrados sem vínculo confirmado.") : siteChecked || c.hasGoogleSource ? fail("dq.social", "Nenhum perfil social encontrado nas fontes consultadas.") : na("dq.social", "Fontes insuficientes para procurar redes sociais."));
  out.push(c.cnpj ? pass("dq.legal_id", c.cnpj) : siteChecked ? warn("dq.legal_id", "CNPJ não publicado no site.") : na("dq.legal_id", "Sem fonte para identificar o CNPJ."));
  const ref = c.lastVerifiedAt ?? c.collectedAt;
  const ageDays = (ctx.now.getTime() - ref.getTime()) / 86400000;
  out.push(ageDays <= 90 ? pass("dq.freshness", `Verificado há ${Math.round(ageDays)} dia(s)`) : ageDays <= 180 ? warn("dq.freshness", `Verificado há ${Math.round(ageDays)} dias`) : fail("dq.freshness", `Sem verificação há ${Math.round(ageDays)} dias`));

  // ── Presença pública no Google ──
  if (!c.hasGoogleSource) {
    for (const k of ["gbp.listing", "gbp.category", "gbp.address", "gbp.phone", "gbp.website", "gbp.hours", "gbp.reviews", "gbp.rating", "gbp.description", "gbp.photos"]) {
      out.push(na(k, "Sem dados públicos do Google Maps para esta empresa (fonte não consultada). Ausência não é tratada como falha."));
    }
  } else {
    const pp = (c.publicProfile ?? {}) as Record<string, unknown>;
    out.push(pass("gbp.listing", "Ficha pública localizada", undefined, sourceUrl));
    out.push(c.category ? pass("gbp.category", c.category, undefined, sourceUrl) : fail("gbp.category", "Ficha sem categoria visível.", undefined, sourceUrl));
    out.push(c.address ? pass("gbp.address", c.address, undefined, sourceUrl) : fail("gbp.address", "Ficha sem endereço visível.", undefined, sourceUrl));
    const googlePhone = c.contacts.some((x) => x.source === "GOOGLE_MAPS_SCRAPER" && x.type === "PHONE");
    out.push(googlePhone ? pass("gbp.phone", "Telefone publicado na ficha", undefined, sourceUrl) : fail("gbp.phone", "Ficha sem telefone visível.", undefined, sourceUrl));
    out.push(c.website ? pass("gbp.website", c.website, undefined, sourceUrl) : fail("gbp.website", "Ficha sem site vinculado.", undefined, sourceUrl));
    out.push(c.openingHours ? pass("gbp.hours", "Horários publicados", undefined, sourceUrl) : fail("gbp.hours", "Horário de funcionamento não publicado.", undefined, sourceUrl));
    const rc = c.reviewCount;
    out.push(rc == null ? na("gbp.reviews", "Quantidade de avaliações não disponível.") : rc >= 50 ? pass("gbp.reviews", `${rc} avaliações`, rc, sourceUrl) : rc >= 10 ? warn("gbp.reviews", `${rc} avaliações (meta: 50+)`, rc, sourceUrl) : fail("gbp.reviews", `${rc} avaliações`, rc, sourceUrl));
    const r = c.rating;
    out.push(r == null ? na("gbp.rating", "Nota pública não disponível.") : r >= 4.5 ? pass("gbp.rating", `Nota ${r.toFixed(1)}`, r, sourceUrl) : r >= 4 ? warn("gbp.rating", `Nota ${r.toFixed(1)}`, r, sourceUrl) : fail("gbp.rating", `Nota ${r.toFixed(1)}`, r, sourceUrl));
    out.push(pp.hasDescription === true ? pass("gbp.description", "Descrição presente", undefined, sourceUrl) : pp.hasDescription === false ? fail("gbp.description", "Ficha sem descrição da empresa.", undefined, sourceUrl) : na("gbp.description", "Não foi possível observar a descrição."));
    const photos = typeof pp.photoCount === "number" ? pp.photoCount : null;
    out.push(photos == null ? na("gbp.photos", "Fotos não observáveis nesta coleta.") : photos >= 5 ? pass("gbp.photos", `${photos} fotos visíveis na coleta`, photos, sourceUrl) : photos >= 1 ? warn("gbp.photos", `${photos} foto(s) visível(is)`, photos, sourceUrl) : fail("gbp.photos", "Nenhuma foto visível na coleta.", 0, sourceUrl));
  }

  // ── Qualidade técnica do website ──
  const siteKeys = ["site.reachable", "site.https", "site.mobile", "site.performance", "site.title", "site.meta_description", "site.h1", "site.h2", "site.broken_links", "site.contact_page", "site.contact_buttons", "site.cta", "site.seo", "site.open_graph", "site.sitemap", "site.robots", "site.structured_data", "site.social_links", "site.accessibility", "site.lang"];
  if (!c.website || !crawl) {
    for (const k of siteKeys) out.push(na(k, c.website ? "Site não analisado." : "Empresa sem site próprio."));
  } else if (crawl.blockedReason && !crawl.reachable) {
    out.push(fail("site.reachable", crawl.blockedReason, undefined, c.website));
    for (const k of siteKeys.slice(1)) out.push(na(k, "Site inacessível para análise."));
  } else if (!crawl.reachable || !home) {
    out.push(fail("site.reachable", `Site não respondeu corretamente${crawl.httpStatus ? ` (HTTP ${crawl.httpStatus})` : ""}.`, crawl.httpStatus, c.website));
    for (const k of siteKeys.slice(1)) out.push(na(k, "Site inacessível para análise."));
  } else if (!crawl.robots.allowedHome) {
    out.push(pass("site.reachable", `HTTP ${crawl.httpStatus}`, crawl.httpStatus, crawl.finalUrl));
    for (const k of siteKeys.slice(1)) out.push(na(k, "robots.txt não permite análise automatizada; respeitado."));
  } else {
    const url = crawl.finalUrl;
    out.push(pass("site.reachable", `HTTP ${crawl.httpStatus} em ${crawl.responseTimeMs} ms`, crawl.responseTimeMs, url));
    out.push(crawl.https ? (crawl.httpRedirectsToHttps === false ? warn("site.https", "HTTPS ativo, mas a versão HTTP não redireciona.", undefined, url) : pass("site.https", "HTTPS ativo", undefined, url)) : crawl.httpsAvailable ? warn("site.https", "Aceita HTTPS, mas o endereço principal abre em HTTP.", undefined, url) : fail("site.https", "Site sem HTTPS.", undefined, url));
    out.push(home.viewport ? pass("site.mobile", "Meta viewport presente", undefined, url) : fail("site.mobile", "Sem meta viewport: tende a não se adaptar ao celular.", undefined, url));
    if (lh?.performance != null) {
      const p = lh.performance;
      const detail = `Lighthouse (celular): ${pct(p)}/100${lh.lcpMs ? ` · LCP ${(lh.lcpMs / 1000).toFixed(1)} s` : ""}`;
      out.push(p >= 0.9 ? pass("site.performance", detail, p, url) : p >= 0.5 ? warn("site.performance", detail, p, url) : fail("site.performance", detail, p, url));
    } else if (crawl.responseTimeMs != null) {
      const t = crawl.responseTimeMs;
      const detail = `Tempo de resposta do servidor: ${t} ms (Lighthouse indisponível)`;
      out.push(t < 800 ? pass("site.performance", detail, t, url) : t < 2000 ? warn("site.performance", detail, t, url) : fail("site.performance", detail, t, url));
    } else out.push(na("site.performance", "Sem medição."));
    const title = home.title ?? "";
    out.push(!title ? fail("site.title", "Página inicial sem <title>.", null, url) : title.length >= 10 && title.length <= 70 ? pass("site.title", title, title.length, url) : warn("site.title", `Título com ${title.length} caracteres (ideal 10–70).`, title.length, url));
    const md = home.metaDescription ?? "";
    out.push(!md ? fail("site.meta_description", "Sem meta description.", null, url) : md.length >= 50 && md.length <= 170 ? pass("site.meta_description", md, md.length, url) : warn("site.meta_description", `Meta description com ${md.length} caracteres (ideal 50–170).`, md.length, url));
    out.push(home.h1.length === 1 ? pass("site.h1", home.h1[0], 1, url) : home.h1.length === 0 ? fail("site.h1", "Página inicial sem H1.", 0, url) : warn("site.h1", `${home.h1.length} títulos H1 (ideal: 1).`, home.h1.length, url));
    out.push(home.h2Count > 0 ? pass("site.h2", `${home.h2Count} subtítulos H2`, home.h2Count, url) : warn("site.h2", "Sem subtítulos H2.", 0, url));
    if (brokenLinks && brokenLinks.checked > 0) {
      const b = brokenLinks.broken.length;
      const detail = b ? `${b} de ${brokenLinks.checked} links internos com erro: ${brokenLinks.broken.slice(0, 3).map((x) => `${x.url} (${x.status ?? "sem resposta"})`).join(", ")}` : `${brokenLinks.checked} links internos verificados, nenhum quebrado`;
      out.push(b === 0 ? pass("site.broken_links", detail, b, url) : b <= 2 ? warn("site.broken_links", detail, b, url) : fail("site.broken_links", detail, b, url));
    } else out.push(na("site.broken_links", "Sem links internos para verificar."));
    const contactPage = pages.find((p) => /contat|contact|fale-?conosco|atendimento/i.test(p.finalUrl));
    const contactLink = home.internalLinks.some((l) => /contat|contact|fale-?conosco/i.test(l.url) || /contato|fale conosco|contact/i.test(l.text));
    out.push(contactPage ? pass("site.contact_page", contactPage.finalUrl, undefined, contactPage.finalUrl) : contactLink ? warn("site.contact_page", "Link de contato encontrado, mas a página não pôde ser analisada.", undefined, url) : fail("site.contact_page", "Nenhuma página de contato encontrada.", undefined, url));
    const buttons = pages.some((p) => p.phones.some((x) => x.via === "tel") || p.emails.some((x) => x.via === "mailto") || p.whatsapp.length > 0 || p.hasContactForm);
    out.push(buttons ? pass("site.contact_buttons", "Links clicáveis de telefone/WhatsApp/e-mail ou formulário", undefined, url) : fail("site.contact_buttons", "Sem botão clicável de contato nem formulário.", undefined, url));
    const ctas = [...new Set(pages.flatMap((p) => p.ctas))];
    out.push(ctas.length ? pass("site.cta", ctas.slice(0, 4).join(" · "), ctas.length, url) : fail("site.cta", "Nenhuma chamada para ação comercial identificada.", 0, url));
    if (lh?.seo != null) {
      const s = lh.seo;
      out.push(s >= 0.9 ? pass("site.seo", `Lighthouse SEO ${pct(s)}/100`, s, url) : s >= 0.7 ? warn("site.seo", `Lighthouse SEO ${pct(s)}/100`, s, url) : fail("site.seo", `Lighthouse SEO ${pct(s)}/100`, s, url));
    } else out.push(na("site.seo", "Lighthouse indisponível nesta execução."));
    const og = home.og;
    out.push(og["og:title"] && (og["og:image"] || og["og:description"]) ? pass("site.open_graph", "og:title e og:image/description presentes", undefined, url) : og["og:title"] ? warn("site.open_graph", "Open Graph incompleto.", undefined, url) : fail("site.open_graph", "Sem Open Graph.", undefined, url));
    out.push(crawl.sitemapFound ? pass("site.sitemap", "sitemap.xml encontrado", undefined, url) : fail("site.sitemap", "Nenhum sitemap XML encontrado.", undefined, url));
    out.push(crawl.robots.found ? pass("site.robots", "robots.txt presente", undefined, url) : warn("site.robots", "Sem robots.txt.", undefined, url));
    const ld = pages.flatMap((p) => p.jsonLd.types);
    const orgLd = ld.some((t) => /Organization|LocalBusiness|Store|Dentist|Medical|Restaurant|Service|Physician|Clinic/i.test(t));
    out.push(orgLd ? pass("site.structured_data", [...new Set(ld)].slice(0, 5).join(", "), undefined, url) : ld.length ? warn("site.structured_data", `Schema.org sem dados da empresa (${[...new Set(ld)].slice(0, 3).join(", ")}).`, undefined, url) : fail("site.structured_data", "Sem dados estruturados Schema.org.", undefined, url));
    const linkedSocial = pages.some((p) => p.socials.length > 0);
    out.push(linkedSocial ? pass("site.social_links", "O site aponta para as redes sociais", undefined, url) : fail("site.social_links", "O site não aponta para redes sociais.", undefined, url));
    if (lh?.accessibility != null) {
      const a = lh.accessibility;
      out.push(a >= 0.9 ? pass("site.accessibility", `Lighthouse acessibilidade ${pct(a)}/100`, a, url) : a >= 0.7 ? warn("site.accessibility", `Lighthouse acessibilidade ${pct(a)}/100`, a, url) : fail("site.accessibility", `Lighthouse acessibilidade ${pct(a)}/100`, a, url));
    } else if (home.images > 0) {
      const ratio = home.imagesWithoutAlt / home.images;
      out.push(ratio <= 0.1 ? pass("site.accessibility", "Imagens com texto alternativo", ratio, url) : ratio <= 0.5 ? warn("site.accessibility", `${home.imagesWithoutAlt} de ${home.images} imagens sem texto alternativo`, ratio, url) : fail("site.accessibility", `${home.imagesWithoutAlt} de ${home.images} imagens sem texto alternativo`, ratio, url));
    } else out.push(na("site.accessibility", "Sem dados suficientes."));
    out.push(home.lang ? pass("site.lang", `lang="${home.lang}"`, home.lang, url) : warn("site.lang", "Idioma da página não declarado.", undefined, url));
  }

  // ── Presença multicanal ──
  const looked = siteChecked || c.hasGoogleSource;
  const hasNet = (...nets: string[]) => socials.find((s) => nets.includes(s.network));
  const socialEval = (key: string, ...nets: string[]) => {
    const s = hasNet(...nets);
    const dead = c.socialProfiles.find((x) => nets.includes(x.network) && x.status === "INVALID");
    if (!s && dead) return fail(key, `Link publicado (${dead.handle}), mas o perfil não foi encontrado${dead.httpStatus ? ` (HTTP ${dead.httpStatus})` : ""}.`, undefined, dead.url);
    if (s) return s.status === "VERIFIED" ? pass(key, `${s.network}: ${s.handle}`, undefined, s.url) : warn(key, `${s.network}: ${s.handle} (vínculo não confirmado)`, undefined, s.url);
    return looked ? fail(key, "Não encontrado nas fontes consultadas (site oficial e ficha pública).") : na(key, "Fontes insuficientes para verificar.");
  };
  out.push(siteChecked ? pass("mc.website", crawl!.finalUrl ?? c.website ?? "", undefined, crawl!.finalUrl) : c.website ? warn("mc.website", "Site informado, mas indisponível ou não analisado.", undefined, c.website) : fail("mc.website", "Sem site próprio."));
  out.push(c.hasGoogleSource ? pass("mc.google", "Ficha no Google Maps", undefined, sourceUrl) : na("mc.google", "Google Maps não consultado para esta empresa."));
  out.push(socialEval("mc.instagram", "INSTAGRAM"));
  out.push(socialEval("mc.facebook", "FACEBOOK"));
  out.push(socialEval("mc.linkedin", "LINKEDIN"));
  out.push(socialEval("mc.video", "YOUTUBE", "TIKTOK"));
  const wa = c.contacts.find((x) => x.type === "WHATSAPP" && x.status !== "INVALID");
  out.push(wa ? pass("mc.whatsapp", "WhatsApp divulgado pela empresa", undefined, wa.sourceUrl) : looked ? fail("mc.whatsapp", "Nenhum link de WhatsApp divulgado nas fontes consultadas.") : na("mc.whatsapp", "Fontes insuficientes."));
  const deadEmails = c.contacts.filter((x) => x.type === "EMAIL" && x.status === "INVALID");
  out.push(emails.length ? pass("mc.email", emails[0]!.normalizedValue) : deadEmails.length ? fail("mc.email", `E-mail publicado (${deadEmails[0]!.normalizedValue}), mas o domínio não recebe mensagens (sem MX).`) : looked ? fail("mc.email", "Nenhum e-mail comercial publicado nas fontes consultadas.") : na("mc.email", "Fontes insuficientes."));
  const trusted = socials.filter((s) => s.confidence >= 0.5);
  if (trusted.length) {
    const brand = new Set([...nameTokens(c.name), ...(c.domain ? c.domain.split(/[.-]/).map(fold) : [])]);
    const coherent = trusted.filter((s) => fold(s.handle.replace(/[@._-]/g, " ")).split(" ").some((t) => t.length > 2 && [...brand].some((b) => b.length > 2 && (b.includes(t) || t.includes(b)))));
    const ratio = coherent.length / trusted.length;
    out.push(ratio >= 0.8 ? pass("mc.consistency", `${coherent.length}/${trusted.length} perfis com identificador coerente`, ratio) : ratio >= 0.4 ? warn("mc.consistency", `${coherent.length}/${trusted.length} perfis coerentes com a marca`, ratio) : fail("mc.consistency", "Identificadores das redes diferentes do nome/domínio.", ratio));
  } else out.push(na("mc.consistency", "Sem perfis para comparar."));

  // ── Oportunidade comercial (PASS = oportunidade com evidência) ──
  const get = (k: string) => out.find((e) => e.key === k);
  const opp = (key: string, from: Evaluation | undefined, test: (e: Evaluation) => boolean | null, detail: (e: Evaluation) => string) => {
    if (!from || from.result === "NOT_EVALUATED") return na(key, "Critério de origem não avaliado.");
    const t = test(from);
    if (t === null) return na(key, "Dados insuficientes.");
    return t ? pass(key, detail(from), from.value, from.url) : fail(key, "Sem oportunidade evidente neste item.");
  };
  out.push(!c.website ? pass("op.website", "Empresa sem site próprio — oportunidade para criação de site.") : crawl && !crawl.reachable ? pass("op.website", "Site informado está fora do ar.", undefined, c.website) : siteChecked ? fail("op.website", "Site próprio ativo.") : na("op.website", "Site não analisado."));
  out.push(opp("op.https", get("site.https"), (e) => e.result !== "PASS", (e) => e.detail ?? "Sem HTTPS forçado"));
  out.push(opp("op.performance", get("site.performance"), (e) => e.result !== "PASS", (e) => e.detail ?? "Site lento"));
  const seoFails = ["site.title", "site.meta_description", "site.h1", "site.sitemap", "site.structured_data"].map(get).filter((e) => e && e.result !== "NOT_EVALUATED");
  out.push(seoFails.length >= 3 ? (seoFails.filter((e) => e!.result !== "PASS").length >= 2 ? pass("op.seo", `${seoFails.filter((e) => e!.result !== "PASS").length} falhas de SEO básico: ${seoFails.filter((e) => e!.result !== "PASS").map((e) => e!.detail).slice(0, 3).join("; ")}`) : fail("op.seo", "SEO básico adequado.")) : na("op.seo", "Site não analisado."));
  const ig = get("mc.instagram");
  const fb = get("mc.facebook");
  out.push(!ig || ig.result === "NOT_EVALUATED" ? na("op.social", "Redes não verificadas.") : ig.result === "FAIL" && fb?.result === "FAIL" ? pass("op.social", "Sem Instagram nem Facebook vinculados nas fontes consultadas.") : fail("op.social", "Possui redes sociais."));
  const rv = get("gbp.reviews");
  const rt = get("gbp.rating");
  out.push(!rv || rv.result === "NOT_EVALUATED" ? na("op.reviews", "Avaliações públicas não disponíveis.") : rv.result === "FAIL" || rt?.result === "FAIL" ? pass("op.reviews", [rv.detail, rt?.detail].filter(Boolean).join(" · "), undefined, sourceUrl) : rv.result === "WARN" || rt?.result === "WARN" ? warn("op.reviews", [rv.detail, rt?.detail].filter(Boolean).join(" · "), undefined, sourceUrl) : fail("op.reviews", "Boa reputação pública."));
  const gbpFails = ["gbp.website", "gbp.hours", "gbp.description", "gbp.phone"].map(get).filter((e) => e && e.result === "FAIL");
  out.push(!c.hasGoogleSource ? na("op.gbp", "Ficha do Google não consultada.") : gbpFails.length ? pass("op.gbp", `Itens ausentes na ficha: ${gbpFails.map((e) => e!.detail).join("; ")}`, undefined, sourceUrl) : fail("op.gbp", "Ficha pública completa nos itens observáveis."));
  out.push(phones.length || emails.length ? pass("op.contactable", `${phones.length} telefone(s), ${emails.length} e-mail(s) disponíveis para contato autorizado`) : fail("op.contactable", "Nenhum canal de contato comercial válido encontrado."));
  return out;
}
