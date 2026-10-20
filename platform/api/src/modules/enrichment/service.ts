import type { Job } from "bullmq";
import { prisma, type Prisma, type DataStatus } from "../../lib/prisma.ts";
import { logger } from "../../lib/logger.ts";
import { fold, hostOf, normName, normalizePhone } from "../../lib/normalize.ts";
import type { EnrichmentJobData } from "../../queues/index.ts";
import { nameSimilarity, nameTokens } from "../companies/dedupe.ts";
import { crawlWebsite, type CrawlResult } from "./crawler.ts";
import { blockedForCollection } from "../privacy/suppression.ts";
import { checkMx, checkSocialLink, lookupCnpj } from "./verify.ts";

const AGENCY_CREDIT = /(desenvolvid|criad[oa] por|feito por|ag[eê]ncia|design(ed)? by|powered by|site por|by\s)/i;

type Agg<T> = Map<string, T & { pages: string[]; via: Set<string> }>;
function add<T extends object>(map: Agg<T>, key: string, value: T, page: string, via: string) {
  const cur = map.get(key);
  if (cur) {
    if (!cur.pages.includes(page)) cur.pages.push(page);
    cur.via.add(via);
  } else map.set(key, { ...value, pages: [page], via: new Set([via]) });
}

/** Consolida as páginas visitadas em achados únicos (com páginas de origem). */
export function aggregate(crawl: CrawlResult) {
  const emails: Agg<{ value: string }> = new Map();
  const phones: Agg<{ e164: string; mobile: boolean }> = new Map();
  const whatsapp: Agg<{ e164: string; url: string }> = new Map();
  const socials: Agg<{ network: string; handle: string; url: string; anchorText: string; context: string }> = new Map();
  const cnpjs = new Set<string>();
  const jsonLdTypes = new Set<string>();
  let jsonLdName: string | undefined;
  let legalNameLd: string | undefined;
  for (const p of crawl.pages) {
    p.emails.forEach((e) => add(emails, e.value, { value: e.value }, p.finalUrl, e.via));
    p.phones.forEach((ph) => add(phones, ph.e164, { e164: ph.e164, mobile: ph.mobile }, p.finalUrl, ph.via));
    p.whatsapp.forEach((w) => add(whatsapp, w.e164, w, p.finalUrl, "link"));
    p.socials.forEach((s) => add(socials, `${s.network}:${s.handle}`, s, p.finalUrl, "link"));
    p.cnpjs.forEach((c) => cnpjs.add(c));
    p.jsonLd.types.forEach((t) => jsonLdTypes.add(t));
    jsonLdName ??= p.jsonLd.name;
    legalNameLd ??= p.jsonLd.legalName;
  }
  return { emails, phones, whatsapp, socials, cnpjs: [...cnpjs], jsonLdTypes: [...jsonLdTypes], jsonLdName, legalNameLd };
}

export async function processEnrichmentJob(job: Job<EnrichmentJobData>) {
  const ej = await prisma.enrichmentJob.findUnique({ where: { id: job.data.enrichmentJobId }, include: { company: true } });
  if (!ej || ["COMPLETED", "CANCELLED"].includes(ej.status)) return;
  const company = ej.company;
  const log = logger.child({ enrichmentJobId: ej.id, companyId: company.id });

  if (!company.website || !company.domain) {
    const reason = company.website ? "O site informado é uma plataforma de terceiros (agenda, rede social, link na bio), não um site próprio." : "Empresa sem site informado.";
    await prisma.$transaction([
      prisma.enrichmentJob.update({ where: { id: ej.id }, data: { status: "COMPLETED", finishedAt: new Date(), details: { skipped: true, reason } } }),
      prisma.company.update({ where: { id: company.id }, data: { enrichmentStatus: "SKIPPED" } }),
    ]);
    return;
  }

  await prisma.$transaction([
    prisma.enrichmentJob.update({ where: { id: ej.id }, data: { status: "RUNNING", startedAt: new Date() } }),
    prisma.company.update({ where: { id: company.id }, data: { enrichmentStatus: "RUNNING" } }),
  ]);

  try {
    const crawl = await crawlWebsite(company.website, { maxPages: 6 });
    const agg = aggregate(crawl);
    const now = new Date();
    const officialHost = hostOf(crawl.finalUrl ?? company.website);
    const inconsistencies: string[] = [];
    const counts = { emails: 0, phones: 0, whatsapp: 0, socials: 0, verified: 0 };
    const fieldSources: Prisma.CompanyFieldSourceCreateManyInput[] = [];
    const src = (field: string, value: string | null, status: DataStatus, confidence: number, sourceUrl: string | null, source: "WEBSITE" | "BRASILAPI_CNPJ" = "WEBSITE") =>
      fieldSources.push({ organizationId: company.organizationId, companyId: company.id, field, value: value?.slice(0, 1000) ?? null, source, sourceUrl, status, confidence, observedAt: now });

    // site
    const home = crawl.pages[0];
    await prisma.companyWebsite.upsert({
      where: { companyId_domain: { companyId: company.id, domain: company.domain } },
      create: {
        companyId: company.id,
        url: company.website,
        finalUrl: crawl.finalUrl,
        domain: company.domain,
        isReachable: crawl.reachable,
        httpStatus: crawl.httpStatus,
        https: crawl.https,
        responseTimeMs: crawl.responseTimeMs,
        robotsAllowed: crawl.robots.allowedHome,
        title: home?.title ?? null,
        metaDescription: home?.metaDescription ?? null,
        signals: { pagesVisited: crawl.pages.length, sitemap: crawl.sitemapFound, robotsFound: crawl.robots.found, httpRedirectsToHttps: crawl.httpRedirectsToHttps, httpsAvailable: crawl.httpsAvailable, method: crawl.method },
        lastCheckedAt: now,
      },
      update: {
        finalUrl: crawl.finalUrl,
        isReachable: crawl.reachable,
        httpStatus: crawl.httpStatus,
        https: crawl.https,
        responseTimeMs: crawl.responseTimeMs,
        robotsAllowed: crawl.robots.allowedHome,
        title: home?.title ?? null,
        metaDescription: home?.metaDescription ?? null,
        signals: { pagesVisited: crawl.pages.length, sitemap: crawl.sitemapFound, robotsFound: crawl.robots.found, httpRedirectsToHttps: crawl.httpRedirectsToHttps, httpsAvailable: crawl.httpsAvailable, method: crawl.method },
        lastCheckedAt: now,
      },
    });
    src("website.reachable", String(crawl.reachable), crawl.reachable ? "VERIFIED" : "UNAVAILABLE", 0.95, crawl.finalUrl ?? company.website);
    if (!crawl.reachable) inconsistencies.push(crawl.blockedReason ?? "O site informado não respondeu corretamente.");

    // contatos excluídos a pedido do titular não voltam a ser coletados
    const blocked = await blockedForCollection(company.organizationId, [...[...agg.emails.values()].map((e) => e.value), ...[...agg.phones.values()].map((p) => p.e164), ...[...agg.whatsapp.values()].map((w) => w.e164)]);
    for (const [k, e] of agg.emails) if (blocked.has(e.value)) agg.emails.delete(k);
    for (const [k, p] of agg.phones) if (blocked.has(p.e164)) agg.phones.delete(k);
    for (const [k, w] of agg.whatsapp) if (blocked.has(w.e164)) agg.whatsapp.delete(k);

    // e-mails: formato + MX; mesmo domínio do site oficial reforça o vínculo
    const existing = await prisma.contact.findMany({ where: { companyId: company.id } });
    for (const e of agg.emails.values()) {
      const mx = await checkMx(e.value);
      const emailHost = e.value.split("@")[1]!;
      const sameDomain = !!officialHost && (emailHost === officialHost || emailHost.endsWith(`.${officialHost}`) || officialHost.endsWith(`.${emailHost}`));
      const status: DataStatus = mx.hasMx === false ? "INVALID" : sameDomain ? "VERIFIED" : "FOUND";
      const confidence = status === "VERIFIED" ? 0.9 : status === "INVALID" ? 0.1 : 0.65;
      const verification = { formatValid: true, mx: mx.hasMx, mxHosts: mx.hosts, mxNote: mx.note, sameDomainAsWebsite: sameDomain, foundOn: e.pages, via: [...e.via], checkedAt: mx.checkedAt };
      await prisma.contact.upsert({
        where: { companyId_type_normalizedValue: { companyId: company.id, type: "EMAIL", normalizedValue: e.value } },
        create: { organizationId: company.organizationId, companyId: company.id, type: "EMAIL", value: e.value, normalizedValue: e.value, source: "WEBSITE", sourceUrl: e.pages[0], status, confidence, verification, lastVerifiedAt: now },
        update: { status, confidence, verification, lastVerifiedAt: now },
      });
      src("email", e.value, status, confidence, e.pages[0] ?? null);
      counts.emails++;
      if (status === "VERIFIED") counts.verified++;
    }

    // telefones: confirmados quando aparecem também em outra fonte (ex.: ficha pública)
    for (const p of agg.phones.values()) {
      const prior = existing.find((c) => c.type === "PHONE" && c.normalizedValue === p.e164 && c.source !== "WEBSITE");
      const status: DataStatus = prior ? "VERIFIED" : "FOUND";
      const info = normalizePhone(p.e164);
      const verification = { e164Valid: !!info?.valid, numberType: info?.type ?? null, foundOn: p.pages, via: [...p.via], crossSource: prior ? prior.source : null, checkedAt: now.toISOString() };
      await prisma.contact.upsert({
        where: { companyId_type_normalizedValue: { companyId: company.id, type: "PHONE", normalizedValue: p.e164 } },
        create: { organizationId: company.organizationId, companyId: company.id, type: "PHONE", value: info?.national ?? p.e164, normalizedValue: p.e164, source: "WEBSITE", sourceUrl: p.pages[0], status, confidence: prior ? 0.95 : 0.75, verification, lastVerifiedAt: now },
        update: { status, confidence: prior ? 0.95 : 0.75, verification, lastVerifiedAt: now },
      });
      src("phone", p.e164, status, prior ? 0.95 : 0.75, p.pages[0] ?? null);
      counts.phones++;
      if (status === "VERIFIED") counts.verified++;
    }
    const googlePhones = existing.filter((c) => c.type === "PHONE" && c.source === "GOOGLE_MAPS_SCRAPER").map((c) => c.normalizedValue);
    if (googlePhones.length && agg.phones.size && !googlePhones.some((g) => agg.phones.has(g))) {
      inconsistencies.push("O telefone publicado no site é diferente do telefone da ficha pública.");
    }

    // WhatsApp divulgado pela própria empresa (link wa.me no site oficial)
    for (const w of agg.whatsapp.values()) {
      await prisma.contact.upsert({
        where: { companyId_type_normalizedValue: { companyId: company.id, type: "WHATSAPP", normalizedValue: w.e164 } },
        create: {
          organizationId: company.organizationId, companyId: company.id, type: "WHATSAPP", value: w.e164, normalizedValue: w.e164, source: "WEBSITE", sourceUrl: w.pages[0],
          status: "VERIFIED", confidence: 0.85, verification: { evidence: "Link de WhatsApp publicado no site oficial", link: w.url, foundOn: w.pages }, lastVerifiedAt: now,
        },
        update: { status: "VERIFIED", lastVerifiedAt: now, verification: { evidence: "Link de WhatsApp publicado no site oficial", link: w.url, foundOn: w.pages } },
      });
      src("whatsapp", w.e164, "VERIFIED", 0.85, w.pages[0] ?? null);
      counts.whatsapp++;
    }

    // redes sociais: link no site oficial é evidência forte; créditos de agência ficam como não confirmados
    const companyTokens = new Set([...nameTokens(company.name), ...(officialHost ? officialHost.split(/[.-]/).map(fold) : [])]);
    let checked = 0;
    for (const s of agg.socials.values()) {
      const handleTokens = fold(s.handle.replace(/^@/, "").replace(/[._-]/g, " ")).split(" ");
      const related = handleTokens.some((t) => t.length > 2 && [...companyTokens].some((c) => c.length > 2 && (c.includes(t) || t.includes(c))));
      const looksCredit = AGENCY_CREDIT.test(s.context) && !related;
      const check = checked < 8 ? await checkSocialLink(s.url) : null;
      checked++;
      const notFound = check?.reachable === false;
      const status: DataStatus = notFound ? "INVALID" : looksCredit ? "FOUND" : "VERIFIED";
      const confidence = notFound ? 0.1 : looksCredit ? 0.35 : related ? 0.9 : 0.75;
      const evidence = looksCredit
        ? `Link encontrado próximo a crédito de desenvolvedor ("${s.context.slice(0, 60)}"); pode não pertencer à empresa.`
        : `Link publicado no site oficial (${s.pages[0]})${related ? "; identificador compatível com o nome/domínio" : ""}.`;
      await prisma.socialProfile.upsert({
        where: { companyId_network_handle: { companyId: company.id, network: s.network as never, handle: s.handle } },
        create: { companyId: company.id, network: s.network as never, handle: s.handle, url: s.url, source: "WEBSITE", sourceUrl: s.pages[0], status, confidence, evidence, httpStatus: check?.status ?? null, lastCheckedAt: check ? now : null },
        update: { status, confidence, evidence, httpStatus: check?.status ?? null, lastCheckedAt: check ? now : undefined },
      });
      src(`social.${s.network.toLowerCase()}`, s.url, status, confidence, s.pages[0] ?? null);
      counts.socials++;
    }

    // CNPJ publicado no site → dados públicos da Receita (BrasilAPI)
    const patch: Prisma.CompanyUpdateInput = {};
    let cnpjInfo = null;
    if (agg.cnpjs.length) {
      cnpjInfo = await lookupCnpj(agg.cnpjs[0]!);
      if (cnpjInfo) {
        if (!company.cnpj) patch.cnpj = cnpjInfo.cnpj;
        if (!company.legalName && cnpjInfo.razaoSocial) patch.legalName = cnpjInfo.razaoSocial;
        src("cnpj", cnpjInfo.cnpj, "VERIFIED", 0.9, cnpjInfo.sourceUrl, "BRASILAPI_CNPJ");
        if (cnpjInfo.razaoSocial) src("legalName", cnpjInfo.razaoSocial, "VERIFIED", 0.9, cnpjInfo.sourceUrl, "BRASILAPI_CNPJ");
        if (cnpjInfo.situacao && !/ativa/i.test(cnpjInfo.situacao)) inconsistencies.push(`Situação cadastral do CNPJ: ${cnpjInfo.situacao}.`);
        if (cnpjInfo.municipio && company.city && fold(cnpjInfo.municipio) !== fold(company.city)) inconsistencies.push(`CNPJ registrado em ${cnpjInfo.municipio}/${cnpjInfo.uf}, diferente da cidade cadastrada (${company.city}).`);
      } else {
        src("cnpj", agg.cnpjs[0]!, "FOUND", 0.6, home?.finalUrl ?? null);
        if (!company.cnpj) patch.cnpj = agg.cnpjs[0]!;
      }
    }
    if (agg.jsonLdName && nameSimilarity(agg.jsonLdName, company.name) < 0.15 && normName(agg.jsonLdName) !== company.normName) {
      inconsistencies.push(`O site se identifica como "${agg.jsonLdName.slice(0, 60)}", nome diferente do cadastrado.`);
    }
    if (!company.description && home?.metaDescription) {
      patch.description = home.metaDescription;
      src("description", home.metaDescription, "FOUND", 0.7, home.finalUrl);
    }
    const bestEmail = [...agg.emails.values()].map((e) => e.value)[0];
    if (!company.primaryEmail && bestEmail) patch.primaryEmail = bestEmail;
    const bestPhone = [...agg.phones.values()][0]?.e164;
    if (!company.primaryPhone && bestPhone) {
      patch.primaryPhone = bestPhone;
      patch.normPhone = bestPhone;
    }

    const status = !crawl.reachable || crawl.blockedReason ? (crawl.pages.length ? "PARTIAL" : "FAILED") : crawl.errors.length ? "PARTIAL" : "DONE";
    const servicesPage = crawl.pages.find((p) => /servic|tratament|especialidad|produto/i.test(p.finalUrl));
    const details = {
      method: crawl.method,
      finalUrl: crawl.finalUrl,
      httpStatus: crawl.httpStatus,
      https: crawl.https,
      httpsAvailable: crawl.httpsAvailable,
      httpRedirectsToHttps: crawl.httpRedirectsToHttps,
      responseTimeMs: crawl.responseTimeMs,
      robots: crawl.robots,
      sitemapFound: crawl.sitemapFound,
      blockedReason: crawl.blockedReason,
      pages: crawl.pages.map((p) => ({ url: p.finalUrl, status: p.status, title: p.title, rendered: p.rendered, ms: p.elapsedMs })),
      errors: crawl.errors,
      counts,
      cnpj: cnpjInfo,
      jsonLdTypes: agg.jsonLdTypes,
      inconsistencies,
      servicesSnippet: servicesPage?.textSnippet || home?.textSnippet || null,
    };

    await prisma.$transaction([
      prisma.company.update({ where: { id: company.id }, data: { ...patch, enrichmentStatus: status, lastEnrichedAt: now, lastVerifiedAt: now } }),
      prisma.companyFieldSource.createMany({ data: fieldSources }),
      prisma.enrichmentJob.update({ where: { id: ej.id }, data: { status: status === "FAILED" ? "FAILED" : "COMPLETED", method: crawl.method, finishedAt: now, details: details as Prisma.InputJsonValue, error: status === "FAILED" ? (crawl.blockedReason ?? crawl.errors[0]?.message ?? "Falha") : null } }),
      prisma.activity.create({
        data: {
          organizationId: company.organizationId,
          companyId: company.id,
          userId: ej.requestedById,
          type: "ENRICHMENT",
          title: status === "FAILED" ? "Enriquecimento sem sucesso" : "Site analisado",
          body: status === "FAILED" ? details.blockedReason ?? "O site não pôde ser analisado." : `${counts.emails} e-mail(s), ${counts.phones} telefone(s), ${counts.whatsapp} WhatsApp, ${counts.socials} rede(s) social(is). ${crawl.pages.length} página(s) visitada(s).`,
          metadata: { enrichmentJobId: ej.id, counts, inconsistencies },
        },
      }),
    ]);
    await import("../audit/service.ts").then((m) => m.recomputeDataQuality(company.id)).catch(() => undefined);
    log.info({ status, counts }, "enriquecimento concluído");
  } catch (err) {
    const message = (err as Error).message.slice(0, 500);
    log.error({ err: message }, "enriquecimento falhou");
    await prisma.$transaction([
      prisma.enrichmentJob.update({ where: { id: ej.id }, data: { status: "FAILED", finishedAt: new Date(), error: message } }),
      prisma.company.update({ where: { id: company.id }, data: { enrichmentStatus: "FAILED" } }),
    ]);
    throw err;
  }
}
