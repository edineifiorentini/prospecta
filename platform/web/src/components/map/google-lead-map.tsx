"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import { loadGoogleMaps, markGoogleFailed } from "./google-loader";
import { areaKeyOf, BRAZIL, buildPopup, COLORS, focusPoints, PIN, pinColor, pointsKeyOf, type LeadMapProps } from "./map-shared";

type Ctx = {
  map: google.maps.Map;
  maps: google.maps.MapsLibrary;
  marker: google.maps.MarkerLibrary;
  info: google.maps.InfoWindow;
  overlays: { setMap?: (m: null) => void; map?: unknown }[];
};

/** Remove círculo e marcadores; protegido porque o Google pode já ter desmontado o mapa após uma falha. */
const clearOverlays = (overlays: Ctx["overlays"]) => {
  for (const o of overlays) {
    try {
      if (o.setMap) o.setMap(null);
      else o.map = null;
    } catch {
      /* mapa já desfeito */
    }
  }
};

const pinElement = (color: string, title: string) => {
  const el = document.createElement("div");
  el.className = "lead-pin lead-pin-google";
  el.innerHTML = PIN(color); // SVG fixo do kit; nenhum dado externo entra aqui
  el.title = title;
  return el;
};

/** Mapa visual do Google (Maps JavaScript API) com os mesmos pinos, raio e balões do mapa do kit. */
export function GoogleLeadMap({ apiKey, mapId, area, points = [], className, overlay, onOpenCompany, label = "Mapa da busca" }: LeadMapProps & { apiKey: string; mapId: string }) {
  const el = useRef<HTMLDivElement>(null);
  const ctx = useRef<Ctx | null>(null);
  const [ready, setReady] = useState(false);
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === "dark";

  useEffect(() => {
    let cancelled = false;
    const container = el.current;
    void loadGoogleMaps(apiKey)
      .then(async () => {
        const maps = (await google.maps.importLibrary("maps")) as google.maps.MapsLibrary;
        const marker = (await google.maps.importLibrary("marker")) as google.maps.MarkerLibrary;
        if (cancelled || !container) return;
        const map = new maps.Map(container, {
          center: { lat: BRAZIL.lat, lng: BRAZIL.lon },
          zoom: 4,
          mapId,
          colorScheme: dark ? "DARK" : "LIGHT",
          disableDefaultUI: true,
          zoomControl: true,
          fullscreenControl: true,
          mapTypeControl: true,
          mapTypeControlOptions: { mapTypeIds: ["roadmap", "hybrid"] },
          clickableIcons: false,
          // rolar a página não move o mapa sem querer (Ctrl + rolagem para zoom)
          gestureHandling: "cooperative",
        });
        ctx.current = { map, maps, marker, info: new maps.InfoWindow(), overlays: [] };
        setReady(true);
      })
      .catch(() => undefined); // a falha já foi registrada em markGoogleFailed; o seletor troca para o OpenStreetMap

    // o Google desenha uma tela de erro no lugar do mapa quando recusa o carregamento (ex.: cota esgotada)
    const observer = new MutationObserver(() => {
      if (container?.querySelector(".gm-err-container")) markGoogleFailed("o Google recusou o carregamento do mapa (chave, faturamento ou cota)");
    });
    if (container) observer.observe(container, { childList: true, subtree: true });
    return () => {
      cancelled = true;
      observer.disconnect();
      if (ctx.current) clearOverlays(ctx.current.overlays);
      ctx.current = null;
      setReady(false);
    };
  }, [apiKey, mapId, dark]);

  const draw = useEffectEvent(() => {
    const c = ctx.current;
    if (!c) return;
    const { map, maps, marker, info } = c;
    clearOverlays(c.overlays);
    c.overlays = [];
    info.close();

    let circle: google.maps.Circle | null = null;
    if (area) {
      const center = { lat: area.lat, lng: area.lon };
      circle = new maps.Circle({ map, center, radius: area.radiusKm * 1000, strokeColor: COLORS.area, strokeOpacity: 0.7, strokeWeight: 2, fillColor: COLORS.area, fillOpacity: 0.08, clickable: false });
      c.overlays.push(circle as unknown as Ctx["overlays"][number]);
      c.overlays.push(new marker.AdvancedMarkerElement({ map, position: center, content: pinElement(COLORS.area, area.label), title: area.label }) as unknown as Ctx["overlays"][number]);
    }
    for (const p of points) {
      const m = new marker.AdvancedMarkerElement({ map, position: { lat: p.lat, lng: p.lon }, content: pinElement(pinColor(area, p), p.name), title: p.name, gmpClickable: true });
      m.addEventListener("gmp-click", () => {
        info.setContent(buildPopup(p, area, onOpenCompany));
        info.open({ anchor: m, map });
      });
      c.overlays.push(m as unknown as Ctx["overlays"][number]);
    }

    // enquadra a área da busca e as empresas dentro dela; resultados distantes continuam no mapa em cinza
    const focus = focusPoints(area, points);
    if (!focus.length && !circle) {
      map.setCenter({ lat: BRAZIL.lat, lng: BRAZIL.lon });
      map.setZoom(4);
      return;
    }
    const bounds = new google.maps.LatLngBounds();
    focus.forEach((p) => bounds.extend({ lat: p.lat, lng: p.lon }));
    if (circle) bounds.union(circle.getBounds()!);
    map.fitBounds(bounds, 28);
    google.maps.event.addListenerOnce(map, "idle", () => {
      if ((map.getZoom() ?? 0) > 16) map.setZoom(16);
    });
  });

  const areaKey = areaKeyOf(area);
  const pointsKey = pointsKeyOf(points);
  useEffect(() => {
    if (ready) draw();
  }, [ready, areaKey, pointsKey]);

  return (
    <div className={cn("lead-map relative isolate overflow-hidden rounded-xl border bg-muted", className)}>
      <div ref={el} className="absolute inset-0" role="region" aria-label={label} />
      {overlay && (
        <div className="pointer-events-none absolute inset-0 z-[5] flex items-center justify-center p-6">
          <div className="max-w-xs rounded-xl border bg-card/95 px-4 py-3 text-center text-sm text-muted-foreground shadow-sm backdrop-blur">{overlay}</div>
        </div>
      )}
    </div>
  );
}
