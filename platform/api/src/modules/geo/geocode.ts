import { env } from "../../config/env.ts";
import { prisma } from "../../lib/prisma.ts";
import { redis } from "../../lib/redis.ts";
import { unprocessable, unavailable } from "../../lib/errors.ts";
import { fold } from "../../lib/normalize.ts";

export type GeoPlace = {
  latitude: number;
  longitude: number;
  label: string;
  /** [sul, norte, oeste, leste] */
  bbox?: [number, number, number, number];
  address?: Record<string, string>;
};

export type LocationInput = { country?: string; state?: string; city?: string; neighborhood?: string };

export const locationText = (l: LocationInput) =>
  [l.neighborhood, l.city, l.state, l.country].map((s) => s?.trim()).filter(Boolean).join(", ");

/** Política do Nominatim: no máximo 1 requisição por segundo, com User-Agent identificável. */
async function waitNominatimSlot() {
  for (let i = 0; i < 20; i++) {
    const ok = await redis.set("pp:nominatim:slot", "1", "PX", 1100, "NX");
    if (ok) return;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw unavailable("Serviço de geocodificação ocupado. Tente novamente em instantes.");
}

export async function geocode(input: LocationInput): Promise<GeoPlace> {
  const text = locationText(input);
  if (!text) throw unprocessable("Informe ao menos a cidade.");
  const key = fold(text);

  const cached = await prisma.geocodeCache.findUnique({ where: { query: key } });
  if (cached) {
    const raw = (cached.raw ?? {}) as { bbox?: [number, number, number, number]; address?: Record<string, string> };
    return { latitude: cached.latitude, longitude: cached.longitude, label: cached.label, bbox: raw.bbox, address: raw.address };
  }

  await waitNominatimSlot();
  const url = new URL("/search", env.NOMINATIM_URL);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("accept-language", "pt-BR");
  url.searchParams.set("q", text);
  if (!input.country || /^bra[sz]il$/i.test(input.country.trim())) url.searchParams.set("countrycodes", "br");

  let res: Response;
  try {
    res = await fetch(url, { headers: { "User-Agent": env.HTTP_USER_AGENT, Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
  } catch {
    throw unavailable("Não foi possível consultar o serviço de mapas (Nominatim/OpenStreetMap).");
  }
  if (!res.ok) throw unavailable(`Geocodificação indisponível (HTTP ${res.status}).`);
  const hits = (await res.json()) as Array<{ lat: string; lon: string; display_name: string; boundingbox?: string[]; address?: Record<string, string> }>;
  const hit = hits[0];
  if (!hit) throw unprocessable(`Local não encontrado: "${text}". Revise cidade, estado e bairro.`);

  const a = hit.address ?? {};
  const label =
    [a.suburb ?? a.neighbourhood ?? a.city_district ?? a.quarter, a.city ?? a.town ?? a.village ?? a.municipality, a.state, a.country]
      .filter(Boolean)
      .join(", ") || hit.display_name;
  const bbox = hit.boundingbox?.map(Number) as [number, number, number, number] | undefined;
  const place: GeoPlace = { latitude: Number(hit.lat), longitude: Number(hit.lon), label, bbox, address: a };

  await prisma.geocodeCache
    .create({ data: { query: key, latitude: place.latitude, longitude: place.longitude, label, raw: { bbox, address: a } } })
    .catch(() => undefined);
  return place;
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
