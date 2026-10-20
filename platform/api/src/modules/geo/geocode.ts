import { env } from "../../config/env.ts";
import { prisma } from "../../lib/prisma.ts";
import { redis } from "../../lib/redis.ts";
import { AppError, unprocessable, unavailable } from "../../lib/errors.ts";
import { fold } from "../../lib/normalize.ts";
import { logger } from "../../lib/logger.ts";

export type GeoPlace = {
  latitude: number;
  longitude: number;
  label: string;
  /** [sul, norte, oeste, leste] */
  bbox?: [number, number, number, number];
  address?: Record<string, string>;
  /** serviço que localizou (Nominatim, Photon ou cache) */
  source?: string;
};

export type LocationInput = { country?: string; state?: string; city?: string; neighborhood?: string };

export const locationText = (l: LocationInput) =>
  [l.neighborhood, l.city, l.state, l.country].map((s) => s?.trim()).filter(Boolean).join(", ");

export const isBrazil = (country?: string) => !country?.trim() || /^(bra[sz]il|br)$/i.test(country.trim());

/** Falha do serviço (fora do ar, limite, rede) — diferente de "local não encontrado". */
class ServiceDown extends Error {}

/** Respeita no máximo 1 requisição por segundo por serviço (política do Nominatim; boa prática no Photon). */
async function waitSlot(service: string) {
  for (let i = 0; i < 20; i++) {
    if (await redis.set(`pp:geo:slot:${service}`, "1", "PX", 1100, "NX")) return;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new ServiceDown("ocupado");
}

async function getJson<T>(url: URL): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { "User-Agent": env.HTTP_USER_AGENT, Accept: "application/json" }, signal: AbortSignal.timeout(12_000) });
  } catch (err) {
    throw new ServiceDown((err as Error).name === "TimeoutError" ? "tempo esgotado" : "sem conexão");
  }
  if (!res.ok) throw new ServiceDown(`HTTP ${res.status}`);
  try {
    return (await res.json()) as T;
  } catch {
    throw new ServiceDown("resposta inválida");
  }
}

type NominatimHit = {
  lat: string;
  lon: string;
  display_name: string;
  name?: string;
  osm_type?: string;
  type?: string;
  addresstype?: string;
  boundingbox?: string[];
  address?: Record<string, string>;
};

const SETTLEMENT = new Set(["city", "town", "village", "hamlet"]);
const LOCALITY = new Set(["suburb", "neighbourhood", "quarter", "city_district", "borough"]);

/**
 * Escolhe o ponto da cidade (ou do bairro) em vez do contorno do município: o centro geométrico de um
 * município grande pode ficar a quilômetros da área urbana (ex.: Tapejara-PR, ~10 km).
 */
export function pickPlace<T>(hits: T[], input: LocationInput, describe: (h: T) => { name?: string; isPoint: boolean; kinds: string[] }): T | undefined {
  const local = !!input.neighborhood?.trim();
  const target = fold((local ? input.neighborhood : input.city) ?? "");
  const wanted = local ? LOCALITY : SETTLEMENT;
  const score = (h: T) => {
    const d = describe(h);
    return (d.isPoint ? 2 : 0) + (d.kinds.some((k) => wanted.has(k)) ? 3 : 0) + (target && d.name && fold(d.name) === target ? 2 : 0);
  };
  let best: T | undefined;
  for (const h of hits) if (best === undefined || score(h) > score(best)) best = h;
  return best;
}

async function nominatim(text: string, input: LocationInput): Promise<GeoPlace | null> {
  await waitSlot("nominatim");
  const url = new URL("/search", env.NOMINATIM_URL);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "5");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("accept-language", "pt-BR");
  url.searchParams.set("q", text);
  if (isBrazil(input.country)) url.searchParams.set("countrycodes", "br");
  const hit = pickPlace(await getJson<NominatimHit[]>(url), input, (h) => ({ name: h.name, isPoint: h.osm_type === "node", kinds: [h.type ?? "", h.addresstype ?? ""] }));
  if (!hit) return null;
  const a = hit.address ?? {};
  const label =
    [a.suburb ?? a.neighbourhood ?? a.city_district ?? a.quarter, a.city ?? a.town ?? a.village ?? a.municipality, a.state, a.country].filter(Boolean).join(", ") ||
    hit.display_name;
  return { latitude: Number(hit.lat), longitude: Number(hit.lon), label, bbox: hit.boundingbox?.map(Number) as GeoPlace["bbox"], address: a, source: "Nominatim" };
}

export type PhotonFeature = {
  geometry: { coordinates: [number, number] };
  properties: {
    name?: string;
    city?: string;
    district?: string;
    locality?: string;
    state?: string;
    country?: string;
    countrycode?: string;
    type?: string;
    osm_type?: string;
    osm_value?: string;
    extent?: [number, number, number, number];
  };
};

/** Converte um resultado do Photon (GeoJSON; extent = [oeste, norte, leste, sul]). */
export function photonToPlace(f: PhotonFeature): GeoPlace {
  const p = f.properties;
  const [lon, lat] = f.geometry.coordinates;
  const label = [...new Set([p.name, p.type === "city" ? undefined : p.city, p.state, p.country].filter(Boolean))].join(", ");
  const bbox = p.extent ? ([p.extent[3], p.extent[1], p.extent[0], p.extent[2]] as GeoPlace["bbox"]) : undefined;
  return { latitude: lat, longitude: lon, label, bbox, address: { city: p.city ?? (p.type === "city" ? p.name ?? "" : ""), state: p.state ?? "", country: p.country ?? "" }, source: "Photon" };
}

async function photon(text: string, input: LocationInput): Promise<GeoPlace | null> {
  await waitSlot("photon");
  const url = new URL("/api/", env.PHOTON_URL);
  url.searchParams.set("q", text);
  url.searchParams.set("limit", "5");
  // Photon não filtra por país: limita ao retângulo do Brasil quando a busca é nacional
  if (isBrazil(input.country)) url.searchParams.set("bbox", "-74.1,-33.9,-28.8,5.4");
  const json = await getJson<{ features?: PhotonFeature[] }>(url);
  const features = (json.features ?? []).filter((f) => !isBrazil(input.country) || f.properties.countrycode?.toUpperCase() === "BR");
  const best = pickPlace(features, input, (f) => ({ name: f.properties.name, isPoint: f.properties.osm_type === "N", kinds: [f.properties.osm_value ?? "", f.properties.type ?? ""] }));
  return best ? photonToPlace(best) : null;
}

const PROVIDERS: [string, (text: string, input: LocationInput) => Promise<GeoPlace | null>][] = [
  ["Nominatim", nominatim],
  ["Photon", photon],
];

/**
 * Localiza o endereço da busca: Nominatim primeiro e Photon como reserva (ambos com dados do OpenStreetMap).
 * Lança 422 se nenhum serviço encontrou o lugar e 503 se todos estiverem fora do ar.
 */
export async function geocode(input: LocationInput): Promise<GeoPlace> {
  const text = locationText(input);
  if (!text) throw unprocessable("Informe ao menos a cidade.");
  const key = fold(text);

  const cached = await prisma.geocodeCache.findUnique({ where: { query: key } });
  if (cached) {
    const raw = (cached.raw ?? {}) as { bbox?: [number, number, number, number]; address?: Record<string, string> };
    return { latitude: cached.latitude, longitude: cached.longitude, label: cached.label, bbox: raw.bbox, address: raw.address, source: "cache" };
  }

  const down: string[] = [];
  for (const [name, provider] of PROVIDERS) {
    try {
      const place = await provider(text, input);
      if (!place) continue;
      await prisma.geocodeCache
        .create({ data: { query: key, latitude: place.latitude, longitude: place.longitude, label: place.label, raw: { bbox: place.bbox, address: place.address, source: place.source } } })
        .catch(() => undefined);
      return place;
    } catch (err) {
      if (!(err instanceof ServiceDown)) throw err;
      down.push(`${name}: ${err.message}`);
      logger.warn({ provider: name, reason: err.message }, "geocodificador indisponível");
    }
  }
  if (down.length === PROVIDERS.length) throw unavailable(`Serviço de mapas indisponível no momento (${down.join("; ")}).`);
  throw unprocessable(`Local não encontrado no mapa: "${text}". Revise cidade, estado e bairro.`);
}

export type GeoAttempt = { place: GeoPlace; problem?: undefined } | { place: null; problem: { kind: "unavailable" | "not_found"; message: string } };

/** Como no kit original: a falta de coordenadas não impede a busca — quem chama decide como seguir só com o texto. */
export async function tryGeocode(input: LocationInput): Promise<GeoAttempt> {
  try {
    return { place: await geocode(input) };
  } catch (err) {
    if (err instanceof AppError && (err.statusCode === 503 || err.statusCode === 422)) {
      return { place: null, problem: { kind: err.statusCode === 503 ? "unavailable" : "not_found", message: err.message } };
    }
    throw err;
  }
}

/** Zoom aproximado do Google Maps para cobrir um raio (km). */
export function zoomForRadius(radiusKm: number) {
  if (radiusKm <= 1) return 16;
  if (radiusKm <= 2) return 15;
  if (radiusKm <= 5) return 14;
  if (radiusKm <= 10) return 13;
  if (radiusKm <= 20) return 12;
  return 11;
}
