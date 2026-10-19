import { env } from "../../config/env.ts";
import { fold, safeHttpUrl, splitList } from "../../lib/normalize.ts";
import { geocode } from "../geo/geocode.ts";
import { osmCategoryLabel, planOsmQuery } from "./osm-categories.ts";
import type { AdapterContext, DiscoveredCompany, DiscoveryAdapter } from "./types.ts";

type OsmElement = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

const BUSINESS_KEYS = ["shop", "amenity", "office", "craft", "healthcare", "tourism", "leisure"];
const escapeRegex = (s: string) => s.replace(/[\\"^$.*+?()[\]{}|]/g, "\\$&");

/** Monta a consulta Overpass QL (somente leitura) para o nicho e a área. */
export function buildOverpassQuery(keyword: string, lat: number, lon: number, radiusM: number, limit: number, nameContains?: string) {
  const plan = planOsmQuery(keyword);
  const around = `(around:${Math.round(radiusM)},${lat.toFixed(6)},${lon.toFixed(6)})`;
  const nameFilter = nameContains ? `["name"~"${escapeRegex(nameContains)}",i]` : "";
  const parts: string[] = [];
  for (const t of plan.tags) parts.push(`nwr["${t.key}"="${t.value}"]${t.extra ?? ""}${nameFilter}${around};`);
  if (!plan.tags.length) {
    // sem nicho conhecido: procura o termo no nome de estabelecimentos comerciais
    const term = escapeRegex(nameContains || keyword);
    for (const key of BUSINESS_KEYS) parts.push(`nwr["${key}"]["name"~"${term}",i]${around};`);
  }
  const query = `[out:json][timeout:90];\n(\n  ${parts.join("\n  ")}\n);\nout center tags qt ${Math.min(limit * 2, 1000)};`;
  return { query, plan };
}

const pick = (tags: Record<string, string>, ...keys: string[]) => {
  for (const k of keys) if (tags[k]) return tags[k];
  return undefined;
};

const SOCIAL_TAGS: Record<string, string> = {
  "contact:instagram": "INSTAGRAM",
  "contact:facebook": "FACEBOOK",
  "contact:linkedin": "LINKEDIN",
  "contact:youtube": "YOUTUBE",
  "contact:tiktok": "TIKTOK",
  "contact:twitter": "X",
  "contact:whatsapp": "WHATSAPP",
};

export function mapOsmElement(el: OsmElement): DiscoveredCompany | null {
  const tags = el.tags ?? {};
  const name = tags.name ?? tags.brand ?? tags.operator;
  if (!name) return null;
  const street = [tags["addr:street"], tags["addr:housenumber"]].filter(Boolean).join(", ");
  const neighborhood = pick(tags, "addr:suburb", "addr:neighbourhood", "addr:district");
  const city = pick(tags, "addr:city", "addr:municipality");
  const state = pick(tags, "addr:state");
  const address = [street, neighborhood, city, state].filter(Boolean).join(" - ") || null;
  const website = safeHttpUrl(pick(tags, "website", "contact:website", "url"));
  const phones = [...splitList(pick(tags, "phone")), ...splitList(pick(tags, "contact:phone")), ...splitList(pick(tags, "contact:mobile"))];
  const emails = [...splitList(pick(tags, "email")), ...splitList(pick(tags, "contact:email"))];
  const socials = Object.entries(SOCIAL_TAGS)
    .filter(([k]) => tags[k])
    .map(([k, network]) => ({ network, url: tags[k]! }));
  const category = osmCategoryLabel(tags);
  const lat = el.lat ?? el.center?.lat ?? null;
  const lon = el.lon ?? el.center?.lon ?? null;
  return {
    name,
    category,
    categories: category ? [category] : [],
    description: tags.description ?? null,
    website,
    phones,
    emails,
    address,
    neighborhood: neighborhood ?? null,
    city: city ?? null,
    state: state ?? null,
    postalCode: tags["addr:postcode"] ?? null,
    country: tags["addr:country"] ?? null,
    latitude: lat,
    longitude: lon,
    sourceUrl: `https://www.openstreetmap.org/${el.type}/${el.id}`,
    osmId: `${el.type}/${el.id}`,
    openingHours: tags.opening_hours ? { osm: tags.opening_hours } : null,
    socials,
    raw: { type: el.type, id: el.id, tags },
  };
}

/** Servidores Overpass: OVERPASS_URL (lista separada por vírgulas) seguido dos espelhos públicos. */
const endpoints = () =>
  [...new Set([...env.OVERPASS_URL.split(",").map((s) => s.trim()).filter(Boolean), "https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter"])];

/** Consulta com retentativas limitadas (3) e espera crescente; troca de espelho em erro transitório. */
async function overpassFetch(query: string, ctx: AdapterContext): Promise<{ elements?: OsmElement[]; remark?: string }> {
  const urls = endpoints();
  let lastError = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    const url = urls[attempt % urls.length]!;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": env.HTTP_USER_AGENT, Accept: "application/json" },
        body: new URLSearchParams({ data: query }).toString(),
        signal: AbortSignal.timeout(120_000),
      });
      if (res.ok) return (await res.json()) as { elements?: OsmElement[]; remark?: string };
      lastError = `HTTP ${res.status} em ${new URL(url).host}`;
      if (![429, 502, 503, 504].includes(res.status)) break;
    } catch (err) {
      lastError = `${(err as Error).name === "TimeoutError" ? "tempo esgotado" : "falha de rede"} em ${new URL(url).host}`;
    }
    if (await ctx.isCancelled()) break;
    const wait = (attempt + 1) * 8000;
    await ctx.progress({ phase: "querying", message: `Servidor OpenStreetMap ocupado (${lastError}). Nova tentativa em ${wait / 1000} s…` });
    await new Promise((r) => setTimeout(r, wait));
  }
  throw new Error(`OpenStreetMap/Overpass indisponível após 3 tentativas (${lastError}). Tente novamente em alguns minutos.`);
}

export const overpassAdapter: DiscoveryAdapter = {
  id: "OSM_OVERPASS",
  label: "OpenStreetMap (Overpass)",
  license: "Dados © colaboradores do OpenStreetMap, licença ODbL 1.0",
  warning: "Cobertura colaborativa: alguns estabelecimentos podem não estar mapeados ou estar desatualizados.",
  async available() {
    return { ok: true };
  },
  async run(ctx: AdapterContext) {
    const p = ctx.params;
    await ctx.progress({ phase: "geocoding", message: "Localizando a área de busca…" });
    const place = await geocode({ country: p.country, state: p.state, city: p.city, neighborhood: p.neighborhood });
    const { query, plan } = buildOverpassQuery(p.keyword, place.latitude, place.longitude, p.radiusKm * 1000, p.limit, p.nameContains);
    ctx.log("overpass query", { plan: plan.label, matched: plan.matchedTerm });
    await ctx.progress({
      phase: "querying",
      message: plan.matchedTerm ? `Consultando OpenStreetMap: ${plan.label} em ${place.label}` : `Consultando OpenStreetMap por nome "${p.keyword}" em ${place.label}`,
    });
    if (await ctx.isCancelled()) return [];

    const started = Date.now();
    const json = await overpassFetch(query, ctx);
    if (json.remark && /runtime error|timed out/i.test(json.remark)) throw new Error(`Overpass: ${json.remark.slice(0, 200)}`);

    const seen = new Set<string>();
    const out: DiscoveredCompany[] = [];
    for (const el of json.elements ?? []) {
      const mapped = mapOsmElement(el);
      if (!mapped) continue;
      const key = fold(mapped.name) + "|" + (mapped.latitude?.toFixed(4) ?? "") + (mapped.longitude?.toFixed(4) ?? "");
      if (seen.has(key)) continue;
      seen.add(key);
      // o OSM raramente traz cidade em cada ponto: completa com a área pesquisada como ESTIMATIVA
      if (!mapped.city) (mapped.raw as Record<string, unknown>).cityEstimatedFromSearch = p.city;
      out.push(mapped);
      if (out.length >= p.limit) break;
    }
    await ctx.progress({ phase: "fetched", message: `${out.length} estabelecimentos recebidos em ${Math.round((Date.now() - started) / 1000)} s.`, found: out.length });
    return out;
  },
};
