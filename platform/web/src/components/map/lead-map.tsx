"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react";
import type { LayerGroup, Map as LeafletMap } from "leaflet";
import { fmtPhone } from "@/lib/format";
import { cn } from "@/lib/utils";

export type MapArea = { lat: number; lon: number; label: string; radiusKm: number };
export type MapPoint = {
  id: string;
  lat: number;
  lon: number;
  name: string;
  category?: string | null;
  rating?: number | null;
  reviewCount?: number | null;
  phone?: string | null;
  inCrm?: boolean;
};

// mesmas cores e pino do kit original (google-maps-scraper-kit)
const COLORS = { area: "#1a73e8", result: "#ea4335", crm: "#16a34a", outside: "#9aa0a6" };
const PIN = (color: string) =>
  `<svg viewBox="0 0 27 43" aria-hidden="true"><path fill="${color}" stroke="#fff" stroke-width="1.5" d="M13.5 1C6.6 1 1 6.6 1 13.5 1 23 13.5 42 13.5 42S26 23 26 13.5C26 6.6 20.4 1 13.5 1z"/><circle cx="13.5" cy="13.5" r="4.5" fill="#fff" fill-opacity=".9"/></svg>`;
const BRAZIL: [number, number] = [-15.78, -47.93];

/** Distância em metros (círculo máximo). */
function distance(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371000;
  const rad = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * rad) / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export const isOutside = (area: MapArea | null, p: { lat: number; lon: number }) => !!area && distance(area.lat, area.lon, p.lat, p.lon) > area.radiusKm * 1000;

type Ctx = { L: typeof import("leaflet"); map: LeafletMap; areaLayer: LayerGroup; pointLayer: LayerGroup };

/**
 * Mapa no estilo do kit original (Leaflet + mapas do OpenStreetMap, sem chave nem custo):
 * pino azul e círculo para o local e o raio da busca, pinos vermelhos para as empresas encontradas.
 */
export function LeadMap({
  area,
  points = [],
  className,
  overlay,
  onOpenCompany,
  label = "Mapa da busca",
}: {
  area: MapArea | null;
  points?: MapPoint[];
  className?: string;
  overlay?: ReactNode;
  onOpenCompany?: (id: string) => void;
  label?: string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const ctx = useRef<Ctx | null>(null);
  const [ready, setReady] = useState(false);

  // o Leaflet usa window/document: carrega só no navegador
  useEffect(() => {
    let cancelled = false;
    void import("leaflet").then((mod) => {
      const L = (mod as unknown as { default?: typeof import("leaflet") }).default ?? mod;
      if (cancelled || !el.current) return;
      const map = L.map(el.current, { zoomControl: false, zoomSnap: 0.25 }).setView(BRAZIL, 4);
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
      const outside = isOutside(area, p);
      // conteúdo montado com textContent: nomes vindos de fontes externas nunca viram HTML
      const box = document.createElement("div");
      box.className = "lead-popup";
      const title = document.createElement("strong");
      title.textContent = p.name;
      box.append(title);
      const meta = [p.category, p.rating != null ? `${p.rating.toFixed(1).replace(".", ",")} ★${p.reviewCount ? ` (${p.reviewCount})` : ""}` : null].filter(Boolean).join(" · ");
      for (const line of [meta, p.phone ? fmtPhone(p.phone) : null, p.inCrm ? "Já está no CRM" : null, outside ? "Fora do raio da busca" : null]) {
        if (!line) continue;
        const d = document.createElement("div");
        d.textContent = line;
        box.append(d);
      }
      const link = document.createElement("a");
      link.href = `/empresas/${p.id}`;
      link.textContent = "Abrir ficha →";
      link.addEventListener("click", (e) => {
        if (!onOpenCompany) return;
        e.preventDefault();
        onOpenCompany(p.id);
      });
      box.append(link);
      L.marker([p.lat, p.lon], { icon: icon(outside ? COLORS.outside : p.inCrm ? COLORS.crm : COLORS.result), title: p.name, riseOnHover: true }).bindPopup(box).addTo(pointLayer);
    }

    // enquadra a área da busca e as empresas dentro dela; resultados distantes (ex.: sede em outra cidade)
    // continuam no mapa em cinza, sem afastar a visão
    const inside = points.filter((p) => !isOutside(area, p));
    const focus = inside.length ? inside : points;
    if (focus.length || circle) {
      const bounds = L.latLngBounds(focus.map((p) => [p.lat, p.lon] as [number, number]));
      if (circle) bounds.extend(circle.getBounds());
      map.fitBounds(bounds, { padding: [28, 28], maxZoom: 16 });
    } else map.setView(BRAZIL, 4);
  });

  // redesenha quando o local, o raio ou a lista de empresas mudam (não a cada renderização)
  const areaKey = area ? `${area.lat.toFixed(5)},${area.lon.toFixed(5)},${area.radiusKm}` : "";
  const pointsKey = points.map((p) => `${p.id}${p.inCrm ? "+" : ""}`).join("|");
  useEffect(() => {
    if (ready) draw();
  }, [ready, areaKey, pointsKey]);

  return (
    <div className={cn("lead-map relative isolate overflow-hidden rounded-xl border bg-muted", className)}>
      <div ref={el} className="absolute inset-0" role="region" aria-label={label} />
      {overlay && (
        <div className="pointer-events-none absolute inset-0 z-[500] flex items-center justify-center p-6">
          <div className="max-w-xs rounded-xl border bg-card/95 px-4 py-3 text-center text-sm text-muted-foreground shadow-sm backdrop-blur">{overlay}</div>
        </div>
      )}
    </div>
  );
}
