import { z } from "zod";
import type { SourceType } from "../../lib/prisma.ts";

/** Empresa descoberta por uma fonte, já mapeada para o modelo interno (sem inventar campos). */
export type DiscoveredCompany = {
  name: string;
  category?: string | null;
  categories?: string[];
  description?: string | null;
  website?: string | null;
  phones: string[];
  emails: string[];
  address?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  sourceUrl?: string | null;
  googlePlaceId?: string | null;
  googleCid?: string | null;
  osmId?: string | null;
  rating?: number | null;
  reviewCount?: number | null;
  openingHours?: unknown;
  priceRange?: string | null;
  socials?: { network: string; url: string }[];
  /** indicadores públicos do perfil (ex.: quantidade de fotos, "reivindicado") */
  publicProfile?: Record<string, unknown> | null;
  raw: Record<string, unknown>;
};

const triState = z.enum(["any", "with", "without"]).default("any");

/** Filtros combináveis aplicados aos resultados de uma busca. */
export const searchFiltersSchema = z
  .object({
    website: triState,
    phone: triState,
    email: triState,
    minRating: z.number().min(0).max(5).optional(),
    maxRating: z.number().min(0).max(5).optional(),
    minReviews: z.number().int().min(0).optional(),
    maxReviews: z.number().int().min(0).optional(),
  })
  .default({ website: "any", phone: "any", email: "any" });

export type SearchFilters = z.infer<typeof searchFiltersSchema>;

export const searchParamsSchema = z.object({
  provider: z.enum(["OSM_OVERPASS", "GOOGLE_MAPS_SCRAPER"]),
  keyword: z.string().trim().min(2, "Informe a palavra-chave ou nicho.").max(120),
  /** nome ou categoria de empresa (opcional, refina por nome) */
  nameContains: z.string().trim().max(120).optional(),
  country: z.string().trim().max(60).default("Brasil"),
  state: z.string().trim().max(60).optional(),
  city: z.string().trim().min(2, "Informe a cidade.").max(80),
  neighborhood: z.string().trim().max(80).optional(),
  radiusKm: z.number().min(0.5).max(50).default(5),
  limit: z.number().int().min(5).max(500).default(60),
  lang: z.enum(["pt", "en", "es"]).default("pt"),
  /** Google Maps: visitar sites para buscar e-mails (mais lento) */
  extractEmails: z.boolean().default(false),
  filters: searchFiltersSchema,
  /** salvar como empresas apenas os resultados que atendem aos filtros */
  saveOnlyMatching: z.boolean().default(true),
});

export type SearchParams = z.infer<typeof searchParamsSchema>;

export type ProgressUpdate = {
  phase: string;
  message?: string;
  elapsedSec?: number;
  maxTimeSec?: number;
  found?: number;
  processed?: number;
  imported?: number;
  duplicates?: number;
  filteredOut?: number;
  percent?: number;
};

export type AdapterContext = {
  searchJobId: string;
  params: SearchParams;
  progress: (p: ProgressUpdate) => Promise<void>;
  isCancelled: () => Promise<boolean>;
  setProviderJobId: (id: string) => Promise<void>;
  log: (msg: string, extra?: Record<string, unknown>) => void;
};

export interface DiscoveryAdapter {
  readonly id: Extract<SourceType, "OSM_OVERPASS" | "GOOGLE_MAPS_SCRAPER">;
  readonly label: string;
  readonly license: string;
  readonly warning?: string;
  available(): Promise<{ ok: boolean; reason?: string }>;
  /** Executa a busca completa e devolve os registros normalizados. */
  run(ctx: AdapterContext): Promise<DiscoveredCompany[]>;
  /** Limpeza no provedor (ex.: apagar job do scraper) — chamada em sucesso, falha e cancelamento. */
  cleanup?(providerJobId: string): Promise<void>;
}

export class CancelledError extends Error {
  constructor() {
    super("Busca cancelada pelo usuário.");
  }
}

/** Avalia os filtros sobre um registro descoberto. Campos ausentes nunca "passam" em filtros de presença. */
export function matchesFilters(c: Pick<DiscoveredCompany, "website" | "phones" | "emails" | "rating" | "reviewCount">, f: SearchFilters): boolean {
  const tri = (mode: "any" | "with" | "without", has: boolean) => mode === "any" || (mode === "with" ? has : !has);
  if (!tri(f.website, !!c.website)) return false;
  if (!tri(f.phone, c.phones.length > 0)) return false;
  if (!tri(f.email, c.emails.length > 0)) return false;
  if (f.minRating !== undefined && (c.rating == null || c.rating < f.minRating)) return false;
  if (f.maxRating !== undefined && (c.rating == null || c.rating > f.maxRating)) return false;
  if (f.minReviews !== undefined && (c.reviewCount == null || c.reviewCount < f.minReviews)) return false;
  if (f.maxReviews !== undefined && (c.reviewCount == null || c.reviewCount > f.maxReviews)) return false;
  return true;
}
