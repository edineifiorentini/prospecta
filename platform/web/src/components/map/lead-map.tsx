"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { GoogleLeadMap } from "./google-lead-map";
import { useGoogleStatus } from "./google-loader";
import { OsmLeadMap } from "./osm-lead-map";
import type { LeadMapProps } from "./map-shared";

export { isOutside, type MapArea, type MapPoint } from "./map-shared";

type MapConfig = { google: { apiKey: string; mapId: string } | null };

/**
 * Mapa da plataforma: o do Google quando há chave configurada (GOOGLE_MAPS_API_KEY) e ele carrega;
 * caso contrário, o do OpenStreetMap — inclusive se o Google recusar a chave ou esgotar a cota.
 */
export function LeadMap(props: LeadMapProps) {
  const config = useQuery({ queryKey: ["map-config"], queryFn: () => api<MapConfig>("/config/maps"), staleTime: Infinity, retry: 1 });
  const google = useGoogleStatus();

  if (config.isLoading) return <div className={cn("lead-map animate-pulse rounded-xl border bg-muted", props.className)} aria-busy />;
  const key = config.data?.google;
  if (key && google.state !== "failed") return <GoogleLeadMap {...props} apiKey={key.apiKey} mapId={key.mapId} />;
  return <OsmLeadMap {...props} notice={key && google.state === "failed" ? "Mapa do Google indisponível; exibindo o OpenStreetMap." : null} />;
}
