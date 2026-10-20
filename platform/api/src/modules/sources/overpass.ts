import { env } from "../../config/env.ts";
import { fold, safeHttpUrl, splitList } from "../../lib/normalize.ts";
import { isBrazil, tryGeocode, type LocationInput } from "../geo/geocode.ts";
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

/** Monta a consulta Overpass QL (somente leitura) para o nicho, num raio em volta de um ponto. */
export function buildOverpassQuery(keyword: string, lat: number, lon: number, radiusM: number, limit: number, nameContains?: string) {
  return composeQuery(keyword, "", `(around:${Math.round(radiusM)},${lat.toFixed(6)},${lon.toFixed(6)})`, limit, nameContains);
}

const UF: Record<string, string> = {
  acre: "AC", alagoas: "AL", amapa: "AP", amazonas: "AM", bahia: "BA", ceara: "CE", "distrito federal": "DF", "espirito santo": "ES", goias: "GO",
  maranhao: "MA", "mato grosso": "MT", "mato grosso do sul": "MS", "minas gerais": "MG", para: "PA", paraiba: "PB", parana: "PR", pernambuco: "PE",
  piaui: "PI", "rio de janeiro": "RJ", "rio grande do norte": "RN", "rio grande do sul": "RS", rondonia: "RO", roraima: "RR", "santa catarina": "SC",
  "sao paulo": "SP", sergipe: "SE", tocantins: "TO",
};

/** Sigla da UF a partir da sigla ou do nome do estado ("PR", "Paraná"). */
export function ufCode(state?: string): string | null {
  const s = state?.trim();
  if (!s) return null;
  if (/^[a-z]{2}$/i.test(s) && Object.values(UF).includes(s.toUpperCase())) return s.toUpperCase();
  return UF[fold(s)] ?? null;
}

/** Regex de nome exato que tolera acentos ausentes ou trocados ("Sao Paulo" casa com "São Paulo"). */
export function accentInsensitive(name: string) {
  const classes: Record<string, string> = { a: "[aáàâã]", e: "[eéê]", i: "[ií]", o: "[oóôõ]", u: "[uúü]", c: "[cç]" };
  return [...fold(name.trim())].map((ch) => classes[ch] ?? escapeRegex(ch)).join("");
}

/**
 * Sem serviço de mapas para achar o centro, delimita a busca pelo limite oficial do município no próprio OpenStreetMap
 * (com bairro, usa o ponto do bairro e o raio pedido).
 */
export function buildOverpassAreaQuery(keyword: string, location: LocationInput, radiusM: number, limit: number, nameContains?: string) {
  if (!location.city?.trim()) throw new Error("Informe a cidade para buscar no OpenStreetMap.");
  const br = isBrazil(location.country);
  const uf = br ? ufCode(location.state) : null;
  const neighborhood = location.neighborhood?.trim();
  const prelude = [
    uf ? `area["ISO3166-2"="BR-${uf}"]["admin_level"="4"]->.uf;` : "",
    `rel${uf ? "(area.uf)" : ""}["boundary"="administrative"]${br ? '["admin_level"="8"]' : ""}["name"~"^${accentInsensitive(location.city)}$",i]->.cityrel;`,
    ".cityrel map_to_area->.scope;",
    neighborhood ? `node(area.scope)["place"~"^(suburb|neighbourhood|quarter)$"]["name"~"^${accentInsensitive(neighborhood)}$",i]->.center;` : "",
  ].filter(Boolean);
  return composeQuery(keyword, prelude.join("\n"), neighborhood ? `(around.center:${Math.round(radiusM)})` : "(area.scope)", limit, nameContains);
}

function composeQuery(keyword: string, prelude: string, scope: string, limit: number, nameContains?: string) {
  const plan = planOsmQuery(keyword);
  const nameFilter = nameContains ? `["name"~"${escapeRegex(nameContains)}",i]` : "";
  const parts: string[] = [];
  for (const t of plan.tags) parts.push(`nwr["${t.key}"="${t.value}"]${t.extra ?? ""}${nameFilter}${scope};`);
  if (!plan.tags.length) {
    // sem nicho conhecido: procura o termo no nome de estabelecimentos comerciais
    const term = escapeRegex(nameContains || keyword);
    for (const key of BUSINESS_KEYS) parts.push(`nwr["${key}"]["name"~"${term}",i]${scope};`);
  }
  // a consulta por limite de município é mais pesada: tempo maior no servidor
  const query = `[out:json][timeout:${prelude ? 150 : 90}];\n${prelude ? `${prelude}\n` : ""}(\n  ${parts.join("\n  ")}\n);\nout center tags qt ${Math.min(limit * 2, 1000)};`;
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
// servidores públicos do Overpass; o principal costuma ficar sobrecarregado, os espelhos dividem a carga
const MIRRORS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
const endpoints = () => [...new Set([...env.OVERPASS_URL.split(",").map((s) => s.trim()).filter(Boolean), ...MIRRORS])];
const ATTEMPTS = 4;

/** Consulta com retentativas limitadas e espera crescente; troca de espelho em erro transitório. */
async function overpassFetch(query: string, ctx: AdapterContext): Promise<{ elements?: OsmElement[]; remark?: string }> {
  const urls = endpoints();
  let lastError = "";
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const url = urls[attempt % urls.length]!;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": env.HTTP_USER_AGENT, Accept: "application/json" },
        body: new URLSearchParams({ data: query }).toString(),
        signal: AbortSignal.timeout(120_000),
      });
      const text = await res.text();
      if (res.ok) {
        try {
          return JSON.parse(text) as { elements?: OsmElement[]; remark?: string };
        } catch {
          // alguns espelhos devolvem página de erro com status 200 quando estão sobrecarregados
          lastError = `resposta inválida em ${new URL(url).host}`;
        }
      } else {
        lastError = `HTTP ${res.status} em ${new URL(url).host}`;
        if (![429, 502, 503, 504].includes(res.status)) break;
      }
    } catch (err) {
      lastError = `${(err as Error).name === "TimeoutError" ? "tempo esgotado" : "falha de rede"} em ${new URL(url).host}`;
    }
    if (await ctx.isCancelled() || attempt === ATTEMPTS - 1) break;
    const wait = (attempt + 1) * 5000;
    await ctx.progress({ phase: "querying", message: `Servidor OpenStreetMap ocupado (${lastError}). Tentando outro servidor em ${wait / 1000} s…` });
    await new Promise((r) => setTimeout(r, wait));
  }
  throw new Error(
    `Servidores públicos do OpenStreetMap sobrecarregados agora (${lastError}). Use Repetir em alguns minutos ou faça a busca pelo Google Maps (opcional).`,
  );
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
    const location = { country: p.country, state: p.state, city: p.city, neighborhood: p.neighborhood };
    const geo = await tryGeocode(location);
    // sem serviço de mapas, a área vem do limite do município no próprio OpenStreetMap
    const { query, plan } = geo.place
      ? buildOverpassQuery(p.keyword, geo.place.latitude, geo.place.longitude, p.radiusKm * 1000, p.limit, p.nameContains)
      : buildOverpassAreaQuery(p.keyword, location, p.radiusKm * 1000, p.limit, p.nameContains);
    const where = geo.place?.label ?? [p.neighborhood, p.city, p.state].filter(Boolean).join(", ");
    ctx.log("overpass query", { plan: plan.label, matched: plan.matchedTerm, byArea: !geo.place });
    const what = plan.matchedTerm ? `${plan.label} em ${where}` : `por nome "${p.keyword}" em ${where}`;
    await ctx.progress({
      phase: "querying",
      message: geo.place
        ? `Consultando OpenStreetMap: ${what}`
        : `${geo.problem.message} Buscando ${what} pelo limite do município no OpenStreetMap (pode levar alguns minutos).`,
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
