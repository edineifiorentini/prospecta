import { fold } from "../../lib/normalize.ts";

const STOP = new Set(["de", "da", "do", "das", "dos", "e", "a", "o", "the", "and", "em", "na", "no", "unidade", "loja", "filial"]);

export function nameTokens(name: string) {
  return new Set(
    fold(name)
      .split(" ")
      .filter((t) => t.length > 1 && !STOP.has(t)),
  );
}

/** Similaridade de Jaccard entre os tokens dos nomes (0–1). */
export function nameSimilarity(a: string, b: string): number {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

/** Distância aproximada em metros (haversine). */
export function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export type DedupeCandidate = {
  id: string;
  name: string;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  normAddress: string | null;
};

export type DedupeProbe = {
  name: string;
  city?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  normAddress?: string | null;
};

/**
 * Regras conservadoras: domínio e telefone podem ser compartilhados por franquias/centrais,
 * então só confirmam duplicidade quando o nome também é parecido (e a cidade não diverge).
 */
export function confirmsDuplicate(reason: "domain" | "phone" | "name", probe: DedupeProbe, cand: DedupeCandidate): boolean {
  const sim = nameSimilarity(probe.name, cand.name);
  const sameCity = !probe.city || !cand.city || fold(probe.city) === fold(cand.city);
  const near =
    probe.latitude != null && probe.longitude != null && cand.latitude != null && cand.longitude != null
      ? distanceMeters(probe.latitude, probe.longitude, cand.latitude, cand.longitude)
      : null;
  if (reason === "domain") return sameCity && (sim >= 0.5 || (near !== null && near < 200));
  if (reason === "phone") return sameCity && (sim >= 0.4 || (near !== null && near < 150));
  // nome normalizado idêntico: exige endereço igual ou proximidade
  if (probe.normAddress && cand.normAddress && probe.normAddress === cand.normAddress) return true;
  if (near !== null) return near < 150;
  return sameCity && !!probe.city && !!cand.city && !probe.normAddress && !cand.normAddress;
}
