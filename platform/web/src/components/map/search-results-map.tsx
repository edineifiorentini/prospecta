"use client";

import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { SectionCard } from "@/components/page";
import { api } from "@/lib/api";
import { fmtNumber } from "@/lib/format";
import { isOutside, LeadMap, type MapArea, type MapPoint } from "./lead-map";

type MapData = { area: MapArea | null; points: MapPoint[]; withoutLocation: number };

const LEGEND = [
  { color: "#1a73e8", label: "Local da busca" },
  { color: "#ea4335", label: "Empresa encontrada" },
  { color: "#16a34a", label: "Já no CRM" },
  { color: "#9aa0a6", label: "Fora do raio" },
];

/** Mapa dos resultados de uma busca, como no kit original: área pesquisada e um pino por empresa. */
export function SearchResultsMap({ searchId, active }: { searchId: string; active: boolean }) {
  const router = useRouter();
  const q = useQuery({
    queryKey: ["search-map", searchId],
    queryFn: () => api<MapData>(`/searches/${searchId}/map`),
    refetchInterval: active ? 6000 : false,
  });
  const d = q.data;
  const outside = d ? d.points.filter((p) => isOutside(d.area, p)).length : 0;
  const description = d
    ? [
        `${fmtNumber(d.points.length)} empresa(s) no mapa`,
        d.withoutLocation ? `${fmtNumber(d.withoutLocation)} sem localização` : null,
        outside ? `${fmtNumber(outside)} fora do raio` : null,
        d.area ? `raio de ${d.area.radiusKm.toLocaleString("pt-BR")} km em ${d.area.label}` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : "Carregando…";

  return (
    <SectionCard className="mb-6 overflow-hidden" title="Mapa" description={description} bodyClassName="p-0">
      <LeadMap
        area={d?.area ?? null}
        points={d?.points ?? []}
        className="h-80 rounded-none border-0 md:h-96"
        label="Mapa com as empresas encontradas na busca"
        overlay={!d ? "Carregando mapa…" : !d.points.length && !d.area ? "Nenhuma empresa com localização nesta busca ainda." : null}
        onOpenCompany={(id) => router.push(`/empresas/${id}`)}
      />
      <ul className="flex flex-wrap gap-x-4 gap-y-1 border-t px-5 py-2.5 text-xs text-muted-foreground" aria-label="Legenda do mapa">
        {LEGEND.map((l) => (
          <li key={l.label} className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full" style={{ background: l.color }} aria-hidden />
            {l.label}
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}
