import { env } from "../../config/env.ts";
import { gmapsAdapter } from "../sources/gmaps.ts";
import { overpassAdapter } from "../sources/overpass.ts";
import type { DiscoveryAdapter } from "../sources/types.ts";

const ALL: Record<string, DiscoveryAdapter> = {
  GOOGLE_MAPS_SCRAPER: gmapsAdapter,
  OSM_OVERPASS: overpassAdapter,
};

/** Fontes habilitadas em SEARCH_SOURCES (padrão: só o Google Maps; o OpenStreetMap pode ser reativado por configuração). */
export const ADAPTERS: Record<string, DiscoveryAdapter> = Object.fromEntries(
  env.SEARCH_SOURCES.split(",")
    .map((s) => s.trim())
    .filter((s) => s in ALL)
    .map((s) => [s, ALL[s]!]),
);

/** Fonte usada para repetir buscas de uma fonte que foi desativada. */
export const DEFAULT_SOURCE = Object.keys(ADAPTERS)[0] ?? "GOOGLE_MAPS_SCRAPER";

export const getAdapter = (id: string) => ADAPTERS[id] ?? null;
