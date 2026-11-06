import { env } from "../../config/env.ts";
import { writeAudit } from "../../lib/audit-log.ts";
import { hostOf, isGenericDomain, normDomain, normalizeEmail, normalizePhone, safeHttpUrl, uniq } from "../../lib/normalize.ts";
import { prisma, type DataStatus, type Prisma } from "../../lib/prisma.ts";
import { redactSecrets } from "../ai/errors.ts";
import { EMAIL_IN_TEXT, PHONE_IN_TEXT } from "../enrichment/extract.ts";
import { parseSocialUrl } from "../enrichment/social.ts";
import { blockedForCollection } from "../privacy/suppression.ts";
import { saveSourceKey, sourceKey } from "../public-data/credentials.ts";
import { assertEnabled, orgIntegration, publicMockActive, requestJson, SourceError, tracked } from "../public-data/http.ts";

/**
 * Instagram pela API OFICIAL da Meta (Graph API, Business Discovery; documentação conferida em 06/11/2026):
 *   GET https://graph.facebook.com/<versão>/<ID da conta comercial da conta>?fields=business_discovery.username(<@>){…}
 * Só lê campos públicos de perfis comerciais ou de criador (bio, site, seguidores, posts). Nada é raspado do site do
 * Instagram. O token e o ID da conta comercial de quem consulta são da própria conta do Prospecta, cifrados.
 */
const GRAPH = "https://graph.facebook.com";
// só campos marcados como públicos na referência do IG User
const FIELDS = "username,biography,website,followers_count,media_count";

type Cred = { token: string; igUserId: string; username?: string | null };

export type InstagramDetails = {
  username: string;
  biography: string | null;
  website: string | null;
  followersCount: number | null;
  mediaCount: number | null;
  fetchedAt: string;
  source: "instagram_api";
  simulated: boolean;
  /** contatos encontrados na bio, como apareceram */
  found: { whatsapp: string[]; phones: string[]; emails: string[]; links: string[] };
};

/** Erros da Graph API vêm como 400 com { error: { code, error_subcode, message } }. */
export function graphError(status: number, body: string): SourceError | null {
  let e: { code?: number; error_subcode?: number; message?: string } | undefined;
  try {
    e = (JSON.parse(body) as { error?: typeof e }).error;
  } catch {
    return null;
  }
  if (!e) return null;
  const msg = redactSecrets(e.message ?? "").slice(0, 200) || null;
  const code = e.code ?? 0;
  if (code === 190 || code === 102 || code === 10 || (code >= 200 && code < 300)) return new SourceError("AUTH", msg, status);
  if ([4, 17, 32, 341, 613, 80002].includes(code)) return new SourceError("RATE_LIMIT", msg, status, 60 * 60_000);
  // não documentado: na prática, perfil inexistente, pessoal ou privado vem como 110 / 2207013 ou "cannot be found"
  if (code === 110 || e.error_subcode === 2207013 || /cannot be found|does not exist|not found/i.test(e.message ?? "")) {
    return new SourceError("NOT_FOUND", "Perfil não encontrado ou não é comercial/criador (perfil pessoal, privado ou com restrição de idade não aparece).", status);
  }
  if (code === 100) return new SourceError("INVALID_REQUEST", msg, status);
  return null;
}

async function credentialOf(organizationId: string): Promise<Cred | null> {
  const raw = await sourceKey(organizationId, "instagram");
  if (!raw) return null;
  try {
    const c = JSON.parse(raw) as Cred;
    return c.token && c.igUserId ? c : null;
  } catch {
    return null;
  }
}

/** @usuario, usuario ou link do perfil → usuario (só letras, números, ponto e sublinhado) */
export function instagramHandle(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  const parsed = /instagram\.com/i.test(v) ? parseSocialUrl(v, "INSTAGRAM") : null;
  const h = (parsed?.network === "INSTAGRAM" ? parsed.handle : v).replace(/^@/, "").toLowerCase();
  return /^[a-z0-9._]{1,30}$/.test(h) ? h : null;
}

/** Contatos declarados na bio. WhatsApp: link wa.me ou número de celular perto de "whats", "zap" ou "wpp". */
export function parseBio(bio: string | null | undefined): InstagramDetails["found"] {
  const text = bio ?? "";
  const whatsapp: string[] = [];
  const phones: string[] = [];
  for (const m of text.matchAll(/(?:wa\.me\/|api\.whatsapp\.com\/send\?phone=)(\d{10,13})/gi)) {
    const p = normalizePhone(m[1]!.startsWith("55") ? `+${m[1]}` : m[1]);
    if (p?.valid) whatsapp.push(p.e164);
  }
  for (const line of text.split(/\r?\n/)) {
    for (const m of line.matchAll(new RegExp(PHONE_IN_TEXT.source, "g"))) {
      const p = normalizePhone(m[0]);
      if (!p?.valid) continue;
      const before = line.slice(Math.max(0, (m.index ?? 0) - 30), m.index ?? 0);
      if (p.isMobile && /whats|zap|wpp|📲|💬/i.test(before)) whatsapp.push(p.e164);
      else phones.push(p.e164);
    }
  }
  const emails = (text.match(new RegExp(EMAIL_IN_TEXT.source, "gi")) ?? []).map((e) => normalizeEmail(e)).filter((e): e is string => !!e);
  const links = (text.match(/\b(?:https?:\/\/|www\.)[^\s]+/gi) ?? []).map((l) => safeHttpUrl(l.startsWith("http") ? l : `https://${l}`)).filter((l): l is string => !!l);
  const wa = uniq(whatsapp);
  return { whatsapp: wa, phones: uniq(phones).filter((p) => !wa.includes(p)), emails: uniq(emails), links: uniq(links) };
}

async function graph<T>(organizationId: string, path: string, params: Record<string, string>, token: string, maxDaily: number): Promise<T> {
  const qs = new URLSearchParams({ ...params, access_token: token });
  const r = await requestJson<T>("instagram", `${GRAPH}/${env.META_GRAPH_VERSION}/${path}?${qs}`, { organizationId, maxDaily, timeoutMs: 20_000, maxRetries: 0, mapError: graphError });
  if (!r) throw new SourceError("NOT_FOUND", "A Graph API não devolveu dados.");
  return r;
}

/** Confere token e conta comercial de quem consulta (GET /<ig-user-id>?fields=username) e guarda cifrado. */
export async function saveInstagramCredential(organizationId: string, userId: string, token: string, igUserId: string) {
  if (!/^\d{5,25}$/.test(igUserId)) throw new SourceError("INVALID_REQUEST", "O ID da conta comercial do Instagram tem só números.");
  const max = (await orgIntegration(organizationId, "instagram")).maxDailyRequests;
  const me = await graph<{ id?: string; username?: string }>(organizationId, igUserId, { fields: "username" }, token, max);
  const cred: Cred = { token, igUserId, username: me.username ?? null };
  const r = await saveSourceKey(organizationId, "instagram", JSON.stringify(cred), userId, token);
  return { ...r, username: cred.username };
}

export async function instagramAccount(organizationId: string) {
  const c = await credentialOf(organizationId);
  return c ? { igUserId: c.igUserId, username: c.username ?? null } : null;
}

/** Perfil comercial/criador pelo @ (Business Discovery). */
export async function businessDiscovery(organizationId: string, username: string, maxDaily: number): Promise<Omit<InstagramDetails, "found">> {
  const simulated = publicMockActive();
  const cred = (await credentialOf(organizationId)) ?? (simulated ? { token: "token-simulado", igUserId: "17841400000000000" } : null);
  if (!cred) throw new SourceError("NOT_CONFIGURED");
  const r = await graph<{ business_discovery?: { username?: string; biography?: string; website?: string; followers_count?: number; media_count?: number } }>(organizationId, cred.igUserId, { fields: `business_discovery.username(${username}){${FIELDS}}` }, cred.token, maxDaily);
  const b = r.business_discovery;
  if (!b) throw new SourceError("NOT_FOUND", "Perfil não encontrado ou não é comercial/criador.");
  return {
    username: b.username ?? username,
    biography: b.biography?.slice(0, 2000) ?? null,
    website: b.website ? safeHttpUrl(b.website) : null,
    followersCount: typeof b.followers_count === "number" ? b.followers_count : null,
    mediaCount: typeof b.media_count === "number" ? b.media_count : null,
    fetchedAt: new Date().toISOString(),
    source: "instagram_api",
    simulated,
  };
}

/** Site da bio é site próprio? (não é rede social, agregador de links nem WhatsApp) */
const ownSite = (url: string | null) => {
  if (!url) return null;
  const host = hostOf(url);
  return host && !isGenericDomain(host) && !parseSocialUrl(url) ? url : null;
};

/**
 * Lê o perfil do Instagram da empresa e grava: dados públicos no perfil social, contatos da bio (origem INSTAGRAM)
 * e o site declarado, quando a empresa ainda não tem site. Nada que já existe é sobrescrito.
 */
export async function instagramForCompany(input: { organizationId: string; companyId: string; userId: string | null; handle?: string | null; force?: boolean }) {
  const cfg = await assertEnabled(input.organizationId, "instagram");
  const c = await prisma.company.findFirst({
    where: { id: input.companyId, organizationId: input.organizationId },
    select: { id: true, name: true, website: true, domain: true, primaryPhone: true, primaryEmail: true, organizationId: true, socialProfiles: true, contacts: { select: { type: true, normalizedValue: true, source: true } } },
  });
  if (!c) throw new SourceError("NOT_FOUND", "Empresa não encontrada.");
  const manual = input.handle ? instagramHandle(input.handle) : null;
  if (input.handle && !manual) throw new SourceError("INVALID_REQUEST", "Informe o @ ou o link do perfil do Instagram.");
  const known = c.socialProfiles.filter((s) => s.network === "INSTAGRAM" && s.status !== "INVALID").sort((a, b) => b.confidence - a.confidence)[0];
  const fromSite = c.website ? instagramHandle(c.website) : null;
  const handle = manual ?? known?.handle.replace(/^@/, "").toLowerCase() ?? fromSite;
  if (!handle) throw new SourceError("NOT_FOUND", "A empresa não tem perfil do Instagram conhecido: informe o @.");

  const existing = c.socialProfiles.find((s) => s.network === "INSTAGRAM" && s.handle.replace(/^@/, "").toLowerCase() === handle);
  const prev = existing?.details as InstagramDetails | null | undefined;
  if (!input.force && prev?.fetchedAt && prev.simulated === publicMockActive() && Date.now() - Date.parse(prev.fetchedAt) < cfg.cacheDays * 86_400_000) {
    return { handle, details: prev, cached: true, added: { whatsapp: 0, phones: 0, emails: 0, website: false } };
  }

  const base = await tracked({ source: "instagram", operation: "company", organizationId: c.organizationId, companyId: c.id }, async () => ({ value: await businessDiscovery(c.organizationId, handle, cfg.maxDailyRequests), records: 1 }));
  const found = parseBio(base.biography);
  const details: InstagramDetails = { ...base, found };
  const url = `https://www.instagram.com/${handle}/`;
  const now = new Date();

  // contatos excluídos a pedido do titular não voltam a ser coletados
  const blocked = await blockedForCollection(c.organizationId, [...found.whatsapp, ...found.phones, ...found.emails]);
  const wa = found.whatsapp.filter((v) => !blocked.has(v));
  const phones = found.phones.filter((v) => !blocked.has(v));
  const emails = found.emails.filter((v) => !blocked.has(v));
  const site = ownSite(details.website) ?? found.links.map(ownSite).find(Boolean) ?? null;

  // vínculo: o perfil confirma a empresa quando site ou telefone da bio batem com os que ela já tem
  const siteMatches = !!site && !!c.domain && normDomain(site) === c.domain;
  const phoneMatches = [...wa, ...phones].some((p) => c.contacts.some((x) => x.normalizedValue === p && x.source !== "INSTAGRAM"));
  const confirmed = siteMatches || phoneMatches;
  const evidence = confirmed
    ? `Perfil comercial lido pela API oficial; ${siteMatches ? "o site da bio é o site da empresa" : "um telefone da bio já constava em outra fonte"}.`
    : manual
      ? "Informado manualmente; perfil comercial lido pela API oficial."
      : `Perfil comercial lido pela API oficial${existing?.evidence ? `; ${existing.evidence}` : ""}.`;
  const status: DataStatus = confirmed ? "VERIFIED" : (existing?.status ?? "FOUND");
  const confidence = confirmed ? 0.9 : Math.max(existing?.confidence ?? 0, manual ? 0.7 : 0.6);

  const fieldSources: Prisma.CompanyFieldSourceCreateManyInput[] = [];
  const fs = (field: string, value: string, st: DataStatus, conf: number) => fieldSources.push({ organizationId: c.organizationId, companyId: c.id, field, value, source: "INSTAGRAM", sourceUrl: url, status: st, confidence: conf, observedAt: now });
  const added = { whatsapp: 0, phones: 0, emails: 0, website: false };

  await prisma.$transaction(async (tx) => {
    await tx.socialProfile.upsert({
      where: { companyId_network_handle: { companyId: c.id, network: "INSTAGRAM", handle: existing?.handle ?? handle } },
      create: { companyId: c.id, network: "INSTAGRAM", handle, url, source: manual ? "MANUAL" : "INSTAGRAM", sourceUrl: url, status, confidence, evidence, httpStatus: 200, details: details as unknown as Prisma.InputJsonValue, lastCheckedAt: now },
      update: { status, confidence, evidence, httpStatus: 200, details: details as unknown as Prisma.InputJsonValue, lastCheckedAt: now },
    });
    fs("social.instagram", url, status, confidence);
    const contact = async (type: "WHATSAPP" | "PHONE" | "EMAIL", value: string, display: string, evidenceText: string) => {
      const prior = c.contacts.find((x) => x.type === type && x.normalizedValue === value);
      if (prior && prior.source !== "INSTAGRAM") {
        // já existia por outra fonte: a bio confirma
        await tx.contact.update({ where: { companyId_type_normalizedValue: { companyId: c.id, type, normalizedValue: value } }, data: { status: "VERIFIED", lastVerifiedAt: now } });
        fs(type.toLowerCase(), value, "VERIFIED", 0.9);
        return false;
      }
      await tx.contact.upsert({
        where: { companyId_type_normalizedValue: { companyId: c.id, type, normalizedValue: value } },
        create: { organizationId: c.organizationId, companyId: c.id, type, value: display, normalizedValue: value, source: "INSTAGRAM", sourceUrl: url, status: "FOUND", confidence: 0.7, verification: { evidence: evidenceText, profile: url, checkedAt: now.toISOString() }, lastVerifiedAt: now },
        update: { lastVerifiedAt: now, verification: { evidence: evidenceText, profile: url, checkedAt: now.toISOString() } },
      });
      fs(type.toLowerCase(), value, "FOUND", 0.7);
      return !prior;
    };
    for (const v of wa) if (await contact("WHATSAPP", v, normalizePhone(v)?.national ?? v, "Número indicado como WhatsApp na bio do Instagram")) added.whatsapp++;
    for (const v of phones) if (await contact("PHONE", v, normalizePhone(v)?.national ?? v, "Telefone publicado na bio do Instagram")) added.phones++;
    for (const v of emails) if (await contact("EMAIL", v, v, "E-mail publicado na bio do Instagram")) added.emails++;
    const patch: Prisma.CompanyUpdateInput = {};
    if (site && (!c.website || (!c.domain && fromSite))) {
      // empresa sem site próprio (ou com o Instagram no lugar do site): o site declarado no perfil passa a ser o site
      patch.website = site;
      patch.domain = normDomain(site);
      patch.normDomain = normDomain(site);
      fs("website", site, "FOUND", 0.7);
      added.website = true;
    }
    const firstPhone = [...wa, ...phones][0];
    if (!c.primaryPhone && firstPhone) {
      patch.primaryPhone = firstPhone;
      patch.normPhone = firstPhone;
    }
    if (!c.primaryEmail && emails[0]) patch.primaryEmail = emails[0];
    if (Object.keys(patch).length) await tx.company.update({ where: { id: c.id }, data: patch });
    if (fieldSources.length) await tx.companyFieldSource.createMany({ data: fieldSources });
    await tx.activity.create({
      data: {
        organizationId: c.organizationId,
        companyId: c.id,
        userId: input.userId,
        type: "ENRICHMENT",
        title: "Perfil do Instagram lido",
        body: `@${handle}: ${wa.length} WhatsApp, ${phones.length} telefone(s), ${emails.length} e-mail(s)${site ? ", site declarado" : ""} na bio.${details.simulated ? " (simulado)" : ""}`,
        metadata: { source: "instagram_api", handle },
      },
    });
  });
  await writeAudit(null, { action: "company.instagram_read", organizationId: c.organizationId, userId: input.userId, entityType: "company", entityId: c.id, metadata: { handle, simulated: details.simulated } });
  return { handle, details, cached: false, added };
}
