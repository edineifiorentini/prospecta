import { fmtPhone } from "@/lib/format";

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

export type LeadMapProps = {
  area: MapArea | null;
  points?: MapPoint[];
  className?: string;
  overlay?: React.ReactNode;
  onOpenCompany?: (id: string) => void;
  label?: string;
};

// mesmas cores e pino do kit original (google-maps-scraper-kit)
export const COLORS = { area: "#1a73e8", result: "#ea4335", crm: "#16a34a", outside: "#9aa0a6" };
export const PIN = (color: string) =>
  `<svg viewBox="0 0 27 43" aria-hidden="true"><path fill="${color}" stroke="#fff" stroke-width="1.5" d="M13.5 1C6.6 1 1 6.6 1 13.5 1 23 13.5 42 13.5 42S26 23 26 13.5C26 6.6 20.4 1 13.5 1z"/><circle cx="13.5" cy="13.5" r="4.5" fill="#fff" fill-opacity=".9"/></svg>`;
export const BRAZIL = { lat: -15.78, lon: -47.93 };

/** Distância em metros (círculo máximo). */
function distance(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371000;
  const rad = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * rad) / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export const isOutside = (area: MapArea | null, p: { lat: number; lon: number }) => !!area && distance(area.lat, area.lon, p.lat, p.lon) > area.radiusKm * 1000;

export const pinColor = (area: MapArea | null, p: MapPoint) => (isOutside(area, p) ? COLORS.outside : p.inCrm ? COLORS.crm : COLORS.result);

/** Pontos para enquadrar: os de dentro do raio (resultados distantes ficam no mapa sem afastar a visão). */
export function focusPoints(area: MapArea | null, points: MapPoint[]) {
  const inside = points.filter((p) => !isOutside(area, p));
  return inside.length ? inside : points;
}

/** Balão da empresa, montado com textContent: nomes vindos de fontes externas nunca viram HTML. */
export function buildPopup(p: MapPoint, area: MapArea | null, onOpenCompany?: (id: string) => void) {
  const box = document.createElement("div");
  box.className = "lead-popup";
  const title = document.createElement("strong");
  title.textContent = p.name;
  box.append(title);
  const meta = [p.category, p.rating != null ? `${p.rating.toFixed(1).replace(".", ",")} ★${p.reviewCount ? ` (${p.reviewCount})` : ""}` : null].filter(Boolean).join(" · ");
  for (const line of [meta, p.phone ? fmtPhone(p.phone) : null, p.inCrm ? "Já está no CRM" : null, isOutside(area, p) ? "Fora do raio da busca" : null]) {
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
  return box;
}

/** Chaves estáveis: o mapa só é redesenhado quando o local, o raio ou a lista de empresas mudam. */
export const areaKeyOf = (area: MapArea | null) => (area ? `${area.lat.toFixed(5)},${area.lon.toFixed(5)},${area.radiusKm}` : "");
export const pointsKeyOf = (points: MapPoint[]) => points.map((p) => `${p.id}${p.inCrm ? "+" : ""}`).join("|");
