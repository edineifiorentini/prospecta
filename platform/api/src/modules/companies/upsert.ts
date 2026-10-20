import { prisma, type Prisma, type SourceType, type DataStatus, type SocialNetwork } from "../../lib/prisma.ts";
import { normAddress, normDomain, normName, normalizeEmail, normalizePhone, uniq } from "../../lib/normalize.ts";
import type { DiscoveredCompany } from "../sources/types.ts";
import { confirmsDuplicate, type DedupeCandidate } from "./dedupe.ts";
import { blockedForCollection } from "../privacy/suppression.ts";
import { parseSocialUrl } from "../enrichment/social.ts";

export const SOURCE_CONFIDENCE: Record<SourceType, number> = {
  GOOGLE_MAPS_SCRAPER: 0.8,
  OSM_OVERPASS: 0.7,
  CSV_IMPORT: 0.5,
  MANUAL: 0.9,
  WEBSITE: 0.75,
  BRASILAPI_CNPJ: 0.9,
  SYSTEM: 0.5,
};

export type UpsertContext = {
  organizationId: string;
  source: SourceType;
  sourceRef?: string | null;
  searchJobId?: string | null;
  userId?: string | null;
  /** cidade da busca, usada como ESTIMATIVA quando a fonte não informa */
  fallbackCity?: string | null;
  fallbackState?: string | null;
  storeRaw?: boolean;
};

export type UpsertResult = { companyId: string; isNew: boolean; matchedBy: string | null };

const SELECT_CANDIDATE = { id: true, name: true, city: true, latitude: true, longitude: true, normAddress: true } as const;

/** Procura uma empresa equivalente na organização seguindo a ordem de confiabilidade dos identificadores. */
export async function findDuplicate(
  tx: Prisma.TransactionClient,
  organizationId: string,
  rec: Pick<DiscoveredCompany, "name" | "city" | "latitude" | "longitude" | "googlePlaceId" | "googleCid" | "osmId" | "website" | "address">,
  phonesE164: string[],
): Promise<{ id: string; matchedBy: string } | null> {
  const base = { organizationId };
  if (rec.googlePlaceId) {
    const hit = await tx.company.findFirst({ where: { ...base, googlePlaceId: rec.googlePlaceId }, select: { id: true } });
    if (hit) return { id: hit.id, matchedBy: "google_place_id" };
  }
  if (rec.googleCid) {
    const hit = await tx.company.findFirst({ where: { ...base, googleCid: rec.googleCid }, select: { id: true } });
    if (hit) return { id: hit.id, matchedBy: "google_cid" };
  }
  if (rec.osmId) {
    const hit = await tx.company.findFirst({ where: { ...base, osmId: rec.osmId }, select: { id: true } });
    if (hit) return { id: hit.id, matchedBy: "osm_id" };
  }
  const probe = { name: rec.name, city: rec.city, latitude: rec.latitude, longitude: rec.longitude, normAddress: normAddress(rec.address) };
  const domain = normDomain(rec.website);
  if (domain) {
    const cands: DedupeCandidate[] = await tx.company.findMany({ where: { ...base, normDomain: domain }, select: SELECT_CANDIDATE, take: 20 });
    const hit = cands.find((c) => confirmsDuplicate("domain", probe, c));
    if (hit) return { id: hit.id, matchedBy: "domain" };
  }
  if (phonesE164.length) {
    const cands: DedupeCandidate[] = await tx.company.findMany({ where: { ...base, normPhone: { in: phonesE164 } }, select: SELECT_CANDIDATE, take: 20 });
    const hit = cands.find((c) => confirmsDuplicate("phone", probe, c));
    if (hit) return { id: hit.id, matchedBy: "phone" };
  }
  const cands: DedupeCandidate[] = await tx.company.findMany({ where: { ...base, normName: normName(rec.name) }, select: SELECT_CANDIDATE, take: 20 });
  const hit = cands.find((c) => confirmsDuplicate("name", probe, c));
  if (hit) return { id: hit.id, matchedBy: "name_address" };
  return null;
}

type FieldEntry = { field: string; value: string | null; status: DataStatus; confidence: number };

const SCALAR_FIELDS = [
  "legalName",
  "cnpj",
  "category",
  "description",
  "website",
  "address",
  "neighborhood",
  "city",
  "state",
  "postalCode",
  "country",
  "sourceUrl",
  "priceRange",
] as const;

/** Grava uma empresa descoberta: cria ou complementa a existente, sem sobrescrever dados já presentes. */
export async function upsertDiscovered(ctx: UpsertContext, rec: DiscoveredCompany): Promise<UpsertResult> {
  const conf = SOURCE_CONFIDENCE[ctx.source];
  const allPhones = uniq(rec.phones.map((p) => normalizePhone(p)).filter((p): p is NonNullable<typeof p> => !!p).map((p) => p.e164));
  const allEmails = uniq(rec.emails.map(normalizeEmail).filter((e): e is string => !!e));
  // contatos excluídos a pedido do titular não voltam a ser coletados
  const blocked = await blockedForCollection(ctx.organizationId, [...allPhones, ...allEmails]);
  const phones = allPhones.filter((p) => !blocked.has(p));
  const emails = allEmails.filter((e) => !blocked.has(e));
  let cityEstimated = false;
  if (!rec.city && ctx.fallbackCity) {
    rec = { ...rec, city: ctx.fallbackCity, state: rec.state ?? ctx.fallbackState ?? null };
    cityEstimated = true;
  }

  return prisma.$transaction(
    async (tx) => {
      const dup = await findDuplicate(tx, ctx.organizationId, rec, phones);
      const fields: FieldEntry[] = [];
      let companyId: string;
      let isNew = false;

      if (!dup) {
        const data: Prisma.CompanyUncheckedCreateInput = {
          organizationId: ctx.organizationId,
          name: rec.name.trim().slice(0, 200),
          legalName: rec.legalName ?? null,
          cnpj: rec.cnpj ?? null,
          category: rec.category ?? null,
          categories: rec.categories ?? [],
          description: rec.description?.slice(0, 2000) ?? null,
          website: rec.website ?? null,
          domain: normDomain(rec.website),
          primaryPhone: phones[0] ?? null,
          primaryEmail: emails[0] ?? null,
          address: rec.address ?? null,
          neighborhood: rec.neighborhood ?? null,
          city: rec.city ?? null,
          state: rec.state ?? null,
          postalCode: rec.postalCode ?? null,
          country: rec.country ?? "BR",
          latitude: rec.latitude ?? null,
          longitude: rec.longitude ?? null,
          sourceUrl: rec.sourceUrl ?? null,
          googlePlaceId: rec.googlePlaceId ?? null,
          googleCid: rec.googleCid ?? null,
          osmId: rec.osmId ?? null,
          rating: rec.rating ?? null,
          reviewCount: rec.reviewCount ?? null,
          openingHours: (rec.openingHours ?? undefined) as Prisma.InputJsonValue | undefined,
          priceRange: rec.priceRange ?? null,
          publicProfile: (rec.publicProfile ?? undefined) as Prisma.InputJsonValue | undefined,
          enrichmentStatus: rec.website ? "NOT_STARTED" : "SKIPPED",
          normName: normName(rec.name),
          normPhone: phones[0] ?? null,
          normDomain: normDomain(rec.website),
          normAddress: normAddress(rec.address),
        };
        const created = await tx.company.create({ data, select: { id: true } });
        companyId = created.id;
        isNew = true;
        fields.push({ field: "name", value: rec.name, status: "FOUND", confidence: conf });
        for (const f of SCALAR_FIELDS) {
          const v = rec[f];
          if (v) fields.push({ field: f, value: String(v), status: f === "city" && cityEstimated ? "ESTIMATED" : "FOUND", confidence: f === "city" && cityEstimated ? 0.4 : conf });
        }
        if (rec.rating != null) fields.push({ field: "rating", value: String(rec.rating), status: "FOUND", confidence: conf });
        if (rec.reviewCount != null) fields.push({ field: "reviewCount", value: String(rec.reviewCount), status: "FOUND", confidence: conf });
        if (rec.openingHours) fields.push({ field: "openingHours", value: JSON.stringify(rec.openingHours).slice(0, 500), status: "FOUND", confidence: conf });
      } else {
        companyId = dup.id;
        const current = await tx.company.findUniqueOrThrow({ where: { id: companyId } });
        const patch: Prisma.CompanyUncheckedUpdateInput = {};
        for (const f of SCALAR_FIELDS) {
          const v = rec[f];
          if (v && !current[f]) {
            (patch as Record<string, unknown>)[f] = v;
            fields.push({ field: f, value: String(v), status: f === "city" && cityEstimated ? "ESTIMATED" : "FOUND", confidence: f === "city" && cityEstimated ? 0.4 : conf });
          }
        }
        if (rec.website && !current.website) {
          patch.domain = normDomain(rec.website);
          patch.normDomain = normDomain(rec.website);
          if (current.enrichmentStatus === "SKIPPED") patch.enrichmentStatus = "NOT_STARTED";
        }
        if (rec.address && !current.normAddress) patch.normAddress = normAddress(rec.address);
        if (!current.primaryPhone && phones[0]) patch.primaryPhone = patch.normPhone = phones[0];
        if (!current.primaryEmail && emails[0]) patch.primaryEmail = emails[0];
        if (current.latitude == null && rec.latitude != null) Object.assign(patch, { latitude: rec.latitude, longitude: rec.longitude });
        if (!current.googlePlaceId && rec.googlePlaceId) patch.googlePlaceId = rec.googlePlaceId;
        if (!current.googleCid && rec.googleCid) patch.googleCid = rec.googleCid;
        if (!current.osmId && rec.osmId) patch.osmId = rec.osmId;
        // nota e avaliações públicas mudam com o tempo: atualiza quando a fonte traz valor
        if (rec.rating != null && rec.rating !== current.rating) {
          patch.rating = rec.rating;
          fields.push({ field: "rating", value: String(rec.rating), status: "FOUND", confidence: conf });
        }
        if (rec.reviewCount != null && rec.reviewCount !== current.reviewCount) {
          patch.reviewCount = rec.reviewCount;
          fields.push({ field: "reviewCount", value: String(rec.reviewCount), status: "FOUND", confidence: conf });
        }
        if (rec.openingHours && !current.openingHours) patch.openingHours = rec.openingHours as Prisma.InputJsonValue;
        if (rec.publicProfile && ctx.source === "GOOGLE_MAPS_SCRAPER") patch.publicProfile = rec.publicProfile as Prisma.InputJsonValue;
        const cats = uniq([...(current.categories ?? []), ...(rec.categories ?? [])]);
        if (cats.length !== current.categories.length) patch.categories = cats;
        if (current.status === "ARCHIVED" && ctx.source !== "CSV_IMPORT") {
          /* empresas arquivadas permanecem arquivadas; a fonte só é registrada */
        }
        if (Object.keys(patch).length) await tx.company.update({ where: { id: companyId }, data: patch });
      }

      // contatos (únicos por empresa/tipo/valor)
      for (const [i, e164] of phones.entries()) {
        const info = normalizePhone(e164);
        await tx.contact.upsert({
          where: { companyId_type_normalizedValue: { companyId, type: "PHONE", normalizedValue: e164 } },
          create: {
            organizationId: ctx.organizationId,
            companyId,
            type: "PHONE",
            value: info?.national ?? e164,
            normalizedValue: e164,
            isPrimary: isNew && i === 0,
            source: ctx.source,
            sourceUrl: rec.sourceUrl ?? null,
            status: info?.valid ? "FOUND" : "INVALID",
            confidence: info?.valid ? conf : 0.2,
            verification: { e164Valid: !!info?.valid, numberType: info?.type ?? null, checkedAt: new Date().toISOString() },
          },
          update: {},
        });
      }
      for (const [i, email] of emails.entries()) {
        await tx.contact.upsert({
          where: { companyId_type_normalizedValue: { companyId, type: "EMAIL", normalizedValue: email } },
          create: {
            organizationId: ctx.organizationId,
            companyId,
            type: "EMAIL",
            value: email,
            normalizedValue: email,
            isPrimary: isNew && i === 0,
            source: ctx.source,
            sourceUrl: rec.sourceUrl ?? null,
            status: "FOUND",
            confidence: conf * 0.9,
            verification: { formatValid: true, mx: null, note: "MX ainda não verificado" },
          },
          update: {},
        });
      }
      for (const s of rec.socials ?? []) {
        const parsed = parseSocialUrl(s.url, s.network as SocialNetwork);
        if (!parsed) continue;
        await tx.socialProfile.upsert({
          where: { companyId_network_handle: { companyId, network: parsed.network, handle: parsed.handle } },
          create: {
            companyId,
            network: parsed.network,
            handle: parsed.handle,
            url: parsed.url,
            source: ctx.source,
            sourceUrl: rec.sourceUrl ?? null,
            status: "FOUND",
            confidence: conf * 0.8,
            evidence: ctx.source === "OSM_OVERPASS" ? "Etiqueta contact:* do estabelecimento no OpenStreetMap" : `Informado pela fonte ${ctx.source}`,
          },
          update: {},
        });
      }

      await tx.leadSource.create({
        data: {
          organizationId: ctx.organizationId,
          companyId,
          sourceType: ctx.source,
          sourceRef: ctx.sourceRef ?? null,
          sourceUrl: rec.sourceUrl ?? null,
          searchJobId: ctx.searchJobId ?? null,
          rawData: ctx.storeRaw === false ? undefined : (rec.raw as Prisma.InputJsonValue),
        },
      });
      if (fields.length) {
        await tx.companyFieldSource.createMany({
          data: fields.map((f) => ({
            organizationId: ctx.organizationId,
            companyId,
            field: f.field,
            value: f.value?.slice(0, 1000) ?? null,
            source: ctx.source,
            sourceRef: ctx.sourceRef ?? null,
            sourceUrl: rec.sourceUrl ?? null,
            status: f.status,
            confidence: f.confidence,
          })),
        });
      }
      if (isNew) {
        await tx.activity.create({
          data: {
            organizationId: ctx.organizationId,
            companyId,
            userId: ctx.userId ?? null,
            type: "IMPORT",
            title: "Empresa adicionada",
            body: `Origem: ${ctx.source}${ctx.sourceRef ? ` (${ctx.sourceRef})` : ""}`,
            metadata: { source: ctx.source, searchJobId: ctx.searchJobId ?? null },
          },
        });
      }
      return { companyId, isNew, matchedBy: dup?.matchedBy ?? null };
    },
    { timeout: 20_000 },
  );
}
