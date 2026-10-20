import { parse } from "csv-parse/sync";
import { env } from "../../config/env.ts";
import { safeHttpUrl, splitList } from "../../lib/normalize.ts";
import { tryGeocode, zoomForRadius } from "../geo/geocode.ts";
import { CancelledError, type AdapterContext, type DiscoveredCompany, type DiscoveryAdapter } from "./types.ts";

/**
 * Adaptador do motor gosom/google-maps-scraper (MIT) executado localmente.
 * A API do motor não tem autenticação e só é acessível pela rede interna do Docker.
 * Importante: raspar o Google Maps contraria os Termos de Serviço do Google; o uso é opcional,
 * com volume baixo (um job por vez) e sem contornar bloqueios, CAPTCHA ou controles de acesso.
 */

type GmapsJob = { ID?: string; id?: string; Status?: string; status?: string; Name?: string; Date?: string };

const base = () => env.GMAPS_SCRAPER_URL.replace(/\/$/, "");

async function call(path: string, init?: RequestInit) {
  return fetch(`${base()}${path}`, { ...init, signal: AbortSignal.timeout(30_000) });
}

/** Profundidade de rolagem aproximada para a quantidade pedida (≈ 20 resultados por nível nos primeiros níveis). */
export const depthForLimit = (limit: number) => Math.max(1, Math.min(20, Math.ceil(limit / 12)));

const json = <T>(raw: string | undefined): T | null => {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

const num = (v?: string) => {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

export function mapGmapsRow(row: Record<string, string>): DiscoveredCompany | null {
  const name = row.title?.trim();
  if (!name) return null;
  const ca = json<Record<string, string>>(row.complete_address) ?? {};
  const images = json<unknown[]>(row.images);
  const owner = json<Record<string, unknown>>(row.owner);
  const about = json<unknown[]>(row.about);
  const reviewsPerRating = json<Record<string, number>>(row.reviews_per_rating);
  const emails = splitList(row.emails);
  const category = row.category?.trim() || null;
  return {
    name,
    category,
    categories: splitList(row.categories ?? "").length ? splitList(row.categories) : category ? [category] : [],
    description: row.descriptions?.trim() || null,
    website: safeHttpUrl(row.website),
    phones: splitList(row.phone),
    emails,
    address: row.address?.trim() || null,
    neighborhood: ca.borough || null,
    city: ca.city || null,
    state: ca.state || null,
    postalCode: ca.postal_code || null,
    country: ca.country || null,
    latitude: num(row.latitude),
    longitude: num(row.longitude),
    sourceUrl: safeHttpUrl(row.link),
    googlePlaceId: row.place_id?.trim() || null,
    googleCid: row.cid?.trim() || null,
    rating: num(row.review_rating),
    reviewCount: num(row.review_count),
    openingHours: json(row.open_hours),
    priceRange: row.price_range?.trim() || null,
    publicProfile: {
      // somente sinais públicos observáveis na ficha; nada é inferido
      photoCount: Array.isArray(images) ? images.length : null,
      hasThumbnail: !!row.thumbnail,
      hasDescription: !!row.descriptions?.trim(),
      hasHours: !!json(row.open_hours),
      ownerListed: owner ? !!(owner.name || owner.id) : null,
      aboutSections: Array.isArray(about) ? about.length : null,
      reviewsPerRating: reviewsPerRating ?? null,
      reservationsLink: !!json<unknown[]>(row.reservations)?.length,
      orderOnlineLink: !!json<unknown[]>(row.order_online)?.length,
      menuLink: !!(json<Record<string, unknown>>(row.menu)?.link),
      businessStatus: row.status?.trim() || null,
    },
    raw: Object.fromEntries(
      Object.entries(row).filter(([k]) => !["user_reviews", "user_reviews_extended", "images", "popular_times"].includes(k)),
    ),
  };
}

export const gmapsAdapter: DiscoveryAdapter = {
  id: "GOOGLE_MAPS_SCRAPER",
  label: "Google Maps (Scraper Kit — opcional)",
  license: "Motor gosom/google-maps-scraper (MIT). Dados do Google Maps sujeitos aos Termos do Google.",
  warning:
    "A raspagem do Google Maps contraria os Termos de Serviço do Google e pode bloquear temporariamente seu IP. Use com moderação: uma busca por vez, quantidades baixas, sem revender dados. Trate os resultados como leads a verificar.",
  async available() {
    if (!env.GMAPS_SCRAPER_ENABLED) return { ok: false, reason: "Desativado (GMAPS_SCRAPER_ENABLED=false)." };
    try {
      const r = await call("/api/v1/jobs");
      return r.ok ? { ok: true } : { ok: false, reason: `Motor respondeu HTTP ${r.status}.` };
    } catch {
      return { ok: false, reason: "Motor de coleta fora do ar (container google-maps-scraper)." };
    }
  },
  async run(ctx: AdapterContext) {
    const p = ctx.params;
    await ctx.progress({ phase: "geocoding", message: "Localizando a área de busca…" });
    // como no kit original: o lugar vai no texto da busca ("dentista em Cambuí, Campinas, SP");
    // as coordenadas só centralizam o mapa e, sem elas, a busca segue pelo texto
    const geo = await tryGeocode({ country: p.country, state: p.state, city: p.city, neighborhood: p.neighborhood });
    if (!geo.place) await ctx.progress({ phase: "geocoding", message: `${geo.problem.message} A busca segue pelo nome do local, como no kit original.` });
    const place = geo.place;
    const where = [p.neighborhood, p.city, p.state].filter(Boolean).join(", ");
    const joiner = p.lang === "en" ? "in" : p.lang === "es" ? "en" : "em";
    const keyword = `${p.nameContains ? `${p.keyword} ${p.nameContains}` : p.keyword} ${joiner} ${where}`;
    const depth = depthForLimit(p.limit);
    const maxTime = Math.min(3600, Math.max(240, Math.round((120 + depth * 40) * (p.extractEmails ? 2 : 1))));

    const body = {
      name: `prospecta:${ctx.searchJobId}`,
      keywords: [keyword],
      lang: p.lang,
      zoom: place ? zoomForRadius(p.radiusKm) : 14,
      lat: place ? place.latitude.toFixed(6) : "0",
      lon: place ? place.longitude.toFixed(6) : "0",
      radius: Math.round(p.radiusKm * 1000),
      depth,
      email: p.extractEmails,
      fast_mode: false,
      max_time: maxTime,
    };
    const created = await call("/api/v1/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!created.ok) throw new Error(`O motor recusou a busca (HTTP ${created.status}): ${(await created.text()).slice(0, 200)}`);
    const { id } = (await created.json()) as { id: string };
    await ctx.setProviderJobId(id);
    ctx.log("gmaps job criado", { id, depth, maxTime });

    const started = Date.now();
    const deadline = started + (maxTime + 240) * 1000;
    let status = "pending";
    while (Date.now() < deadline) {
      if (await ctx.isCancelled()) throw new CancelledError();
      const r = await call(`/api/v1/jobs/${id}`);
      if (r.ok) {
        const j = (await r.json()) as GmapsJob;
        status = (j.Status ?? j.status ?? "").toLowerCase();
      }
      const elapsedSec = Math.round((Date.now() - started) / 1000);
      if (status === "ok" || status === "failed") break;
      await ctx.progress({
        phase: status === "working" ? "running" : "waiting",
        message: status === "working" ? `Coletando no Google Maps (até ${Math.round(maxTime / 60)} min)…` : "Aguardando o motor iniciar (um job por vez)…",
        elapsedSec,
        maxTimeSec: maxTime,
        percent: status === "working" ? Math.min(95, Math.round((elapsedSec / maxTime) * 100)) : 0,
      });
      await new Promise((res) => setTimeout(res, 5000));
    }
    if (status === "failed") throw new Error("O motor de coleta reportou falha. Pode ser bloqueio temporário do Google: aguarde e tente com menos resultados.");
    if (status !== "ok") throw new Error("Tempo limite excedido aguardando o motor de coleta.");

    await ctx.progress({ phase: "downloading", message: "Baixando resultados do motor…" });
    const dl = await call(`/api/v1/jobs/${id}/download`);
    if (!dl.ok) throw new Error(`Falha ao baixar o CSV do motor (HTTP ${dl.status}).`);
    const csv = await dl.text();
    const rows = parse(csv, { columns: true, skip_empty_lines: true, relax_column_count: true, bom: true }) as Record<string, string>[];
    const out = rows.map(mapGmapsRow).filter((r): r is DiscoveredCompany => !!r);
    await ctx.progress({ phase: "fetched", message: `${out.length} empresas recebidas do Google Maps.`, found: out.length });
    return out.slice(0, p.limit);
  },
  async cleanup(providerJobId: string) {
    await call(`/api/v1/jobs/${providerJobId}`, { method: "DELETE" }).catch(() => undefined);
  },
};
