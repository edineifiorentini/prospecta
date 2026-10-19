import { gmapsAdapter } from "../sources/gmaps.ts";
import { overpassAdapter } from "../sources/overpass.ts";
import type { DiscoveryAdapter } from "../sources/types.ts";

export const ADAPTERS: Record<string, DiscoveryAdapter> = {
  OSM_OVERPASS: overpassAdapter,
  GOOGLE_MAPS_SCRAPER: gmapsAdapter,
};

export const getAdapter = (id: string) => ADAPTERS[id] ?? null;
