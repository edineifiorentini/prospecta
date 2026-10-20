"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { LayerGroup, Map as LeafletMap } from "leaflet";
import { cn } from "@/lib/utils";
import { areaKeyOf, BRAZIL, buildPopup, COLORS, focusPoints, PIN, pinColor, pointsKeyOf, type LeadMapProps } from "./map-shared";

type Ctx = { L: typeof import("leaflet"); map: LeafletMap; areaLayer: LayerGroup; pointLayer: LayerGroup };

/**
 * Mapa do OpenStreetMap (Leaflet), o mesmo do kit original, sem chave nem custo. É usado quando não há chave
 * do Google ou quando o Google recusa o carregamento; `notice` explica o motivo da troca.
 */
export function OsmLeadMap({ area, points = [], className, overlay, onOpenCompany, label = "Mapa da busca", notice }: LeadMapProps & { notice?: string | null }) {
  const el = useRef<HTMLDivElement>(null);
  const ctx = useRef<Ctx | null>(null);
  const [ready, setReady] = useState(false);

  // o Leaflet usa window/document: carrega só no navegador
  useEffect(() => {
    let cancelled = false;
    void import("leaflet").then((mod) => {
      const L = (mod as unknown as { default?: typeof import("leaflet") }).default ?? mod;
      if (cancelled || !el.current) return;
      const map = L.map(el.current, { zoomControl: false, zoomSnap: 0.25 }).setView([BRAZIL.lat, BRAZIL.lon], 4);
      L.control.zoom({ position: "bottomright", zoomInTitle: "Aproximar", zoomOutTitle: "Afastar" }).addTo(map);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        className: "lead-map-tiles",
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>',
      }).addTo(map);
      ctx.current = { L, map, areaLayer: L.layerGroup().addTo(map), pointLayer: L.layerGroup().addTo(map) };
      setReady(true);
    });
    return () => {
      cancelled = true;
      ctx.current?.map.remove();
      ctx.current = null;
    };
  }, []);

  // acompanha mudanças de tamanho (menu recolhido, rotação do celular)
  useEffect(() => {
    if (!ready || !el.current) return;
    const ro = new ResizeObserver(() => ctx.current?.map.invalidateSize());
    ro.observe(el.current);
    return () => ro.disconnect();
  }, [ready]);

  const draw = useEffectEvent(() => {
    const c = ctx.current;
    if (!c) return;
    const { L, map, areaLayer, pointLayer } = c;
    const icon = (color: string) => L.divIcon({ className: "lead-pin", html: PIN(color), iconSize: [27, 43], iconAnchor: [13.5, 42], popupAnchor: [0, -38] });
    areaLayer.clearLayers();
    pointLayer.clearLayers();

    let circle: ReturnType<typeof L.circle> | null = null;
    if (area) {
      circle = L.circle([area.lat, area.lon], { radius: area.radiusKm * 1000, color: COLORS.area, weight: 2, opacity: 0.7, fillColor: COLORS.area, fillOpacity: 0.08, interactive: false }).addTo(areaLayer);
      L.marker([area.lat, area.lon], { icon: icon(COLORS.area), title: area.label, keyboard: false }).bindTooltip(area.label, { direction: "top", offset: [0, -40] }).addTo(areaLayer);
    }
    for (const p of points) {
      L.marker([p.lat, p.lon], { icon: icon(pinColor(area, p)), title: p.name, riseOnHover: true }).bindPopup(buildPopup(p, area, onOpenCompany)).addTo(pointLayer);
    }

    // enquadra a área da busca e as empresas dentro dela; resultados distantes continuam no mapa em cinza
    const focus = focusPoints(area, points);
    if (focus.length || circle) {
      const bounds = L.latLngBounds(focus.map((p) => [p.lat, p.lon] as [number, number]));
      if (circle) bounds.extend(circle.getBounds());
      map.fitBounds(bounds, { padding: [28, 28], maxZoom: 16 });
    } else map.setView([BRAZIL.lat, BRAZIL.lon], 4);
  });

  const areaKey = areaKeyOf(area);
  const pointsKey = pointsKeyOf(points);
  useEffect(() => {
    if (ready) draw();
  }, [ready, areaKey, pointsKey]);

  return (
    <div className={cn("lead-map relative isolate overflow-hidden rounded-xl border bg-muted", className)}>
      <div ref={el} className="absolute inset-0" role="region" aria-label={label} />
      {notice && (
        <p className="pointer-events-none absolute top-2 left-2 z-[500] max-w-[calc(100%-1rem)] rounded-md border bg-card/95 px-2 py-1 text-[11px] text-muted-foreground shadow-sm" role="status">
          {notice}
        </p>
      )}
      {overlay && (
        <div className="pointer-events-none absolute inset-0 z-[500] flex items-center justify-center p-6">
          <div className="max-w-xs rounded-xl border bg-card/95 px-4 py-3 text-center text-sm text-muted-foreground shadow-sm backdrop-blur">{overlay}</div>
        </div>
      )}
    </div>
  );
}
