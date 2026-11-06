"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SectionCard } from "@/components/page";
import { api, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useSyncedState } from "@/lib/hooks";

type Size = "INDIVIDUAL" | "MICRO" | "PEQUENO" | "MEDIO" | "GRANDE";
type Offer = {
  id: string;
  name: string;
  targetSegments?: string[];
  targetSizes?: Size[];
  idealEmployees?: { min: number; max: number };
  criteriaWeights: Record<string, number>;
};
type Criterion = { key: string; indicator: "FIT" | "OPPORTUNITY" | "RELIABILITY"; label: string; weight: number; requires?: string; optIn?: boolean };
type AiView = { intelligence: { offers?: Offer[] }; segments: { id: string; label: string }[]; criteria: Criterion[] };

const SIZES: { id: Size; label: string }[] = [
  { id: "MICRO", label: "Micro" },
  { id: "PEQUENO", label: "Pequeno" },
  { id: "MEDIO", label: "Médio" },
  { id: "GRANDE", label: "Grande" },
];

/** Modelos de partida: o usuário ajusta os pesos depois. */
const TEMPLATES: Offer[] = [
  { id: "sites", name: "Desenvolvimento de sites", criteriaWeights: { "opp.site_gaps": 35, "opp.no_website": 35, "opp.whatsapp_lines": 0, "opp.other_lines": 0, "fit.whatsapp": 0 } },
  { id: "atendimento", name: "Gestão de atendimento", criteriaWeights: {} },
  { id: "alto-custo", name: "Sistema de alto custo", targetSizes: ["MEDIO", "GRANDE"], idealEmployees: { min: 50, max: 100000 }, criteriaWeights: { "fit.size": 40, "opp.scale": 30 } },
];

const slug = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "oferta";

export function OffersSettings() {
  const qc = useQueryClient();
  const { can } = useSession();
  const editable = can("settings:manage");
  const q = useQuery({ queryKey: ["ai-settings"], queryFn: () => api<AiView>("/ai/settings") });
  const [offers, setOffers] = useSyncedState(q.data, (d) => d?.intelligence.offers ?? []);
  const save = useMutation({
    mutationFn: () => api("/org", { method: "PATCH", body: { settings: { intelligence: { offers } } } }),
    onSuccess: () => {
      toast.success("Ofertas salvas");
      qc.invalidateQueries({ queryKey: ["ai-settings"] });
      qc.invalidateQueries({ queryKey: ["offers"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (!q.data) return null;
  const criteria = q.data.criteria.filter((c) => c.indicator !== "RELIABILITY");
  const update = (i: number, patch: Partial<Offer>) => setOffers((list) => list.map((o, j) => (j === i ? { ...o, ...patch } : o)));
  const add = (t: Offer) => {
    const ids = new Set(offers.map((o) => o.id));
    let id = t.id;
    for (let n = 2; ids.has(id); n++) id = `${t.id}-${n}`;
    setOffers((list) => [...list, { ...t, id }]);
  };

  return (
    <div className="grid gap-6">
      <SectionCard title="Ofertas e score por produto" description="A mesma empresa pode ser ótima para uma oferta e fraca para outra. Cada oferta reaproveita as evidências da empresa com pesos próprios; a prioridade A/B/C da conta continua a mesma.">
        <div className="grid gap-3 text-sm text-muted-foreground">
          <p>Os pesos são aplicados só às evidências coletadas: falta de dado não pesa contra a empresa. Critérios opcionais (como falhas técnicas do site ou ausência de site) só entram quando a oferta dá peso a eles.</p>
          {editable && (
            <div className="flex flex-wrap gap-2">
              {TEMPLATES.map((t) => (
                <Button key={t.id} size="sm" variant="outline" onClick={() => add(t)} disabled={offers.length >= 10}>
                  <Plus /> {t.name}
                </Button>
              ))}
              <Button size="sm" variant="outline" onClick={() => add({ id: "oferta", name: "Nova oferta", criteriaWeights: {} })} disabled={offers.length >= 10}>
                <Plus /> Em branco
              </Button>
            </div>
          )}
          {!offers.length && <p>Nenhuma oferta cadastrada.</p>}
        </div>
      </SectionCard>

      {offers.map((o, i) => (
        <SectionCard
          key={o.id}
          title={o.name}
          description={`Identificador: ${o.id}`}
          actions={
            editable && (
              <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setOffers((list) => list.filter((_, j) => j !== i))}>
                <Trash2 /> Remover
              </Button>
            )
          }
        >
          <div className="grid gap-4 text-sm">
            <div className="grid gap-1.5 sm:max-w-sm">
              <Label className="text-xs">Nome</Label>
              <Input value={o.name} onChange={(e) => update(i, { name: e.target.value, id: o.id === slug(o.name) ? slug(e.target.value) : o.id })} disabled={!editable} />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">Segmentos-alvo (nenhum marcado = os da conta)</Label>
              <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                {q.data!.segments.map((s) => (
                  <label key={s.id} className="flex items-center gap-1.5 text-xs">
                    <Checkbox checked={o.targetSegments?.includes(s.id) ?? false} disabled={!editable} onCheckedChange={(x) => update(i, { targetSegments: x ? [...(o.targetSegments ?? []), s.id] : (o.targetSegments ?? []).filter((y) => y !== s.id) })} />
                    {s.label}
                  </label>
                ))}
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">Portes-alvo (nenhum marcado = os da conta; só pesa com dados empresariais)</Label>
              <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                {SIZES.map((s) => (
                  <label key={s.id} className="flex items-center gap-1.5 text-xs">
                    <Checkbox checked={o.targetSizes?.includes(s.id) ?? false} disabled={!editable} onCheckedChange={(x) => update(i, { targetSizes: x ? [...(o.targetSizes ?? []), s.id] : (o.targetSizes ?? []).filter((y) => y !== s.id) })} />
                    {s.label}
                  </label>
                ))}
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">Pesos (vazio = peso padrão da conta; 0 = ignorar)</Label>
              <div className="grid gap-2 sm:grid-cols-2">
                {criteria.map((c) => (
                  <label key={c.key} className="flex items-center justify-between gap-3 rounded-md border px-2.5 py-1.5 text-xs">
                    <span className="min-w-0">
                      {c.label}
                      <span className="ml-1.5 text-muted-foreground">{c.indicator === "FIT" ? "aderência" : "oportunidade"}</span>
                      {c.optIn && <Badge variant="outline" className="ml-1.5 text-[10px]">opcional</Badge>}
                    </span>
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      className="h-7 w-16 shrink-0"
                      placeholder={String(c.weight)}
                      value={o.criteriaWeights[c.key] ?? ""}
                      disabled={!editable}
                      onChange={(e) => {
                        const w = { ...o.criteriaWeights };
                        if (e.target.value === "") delete w[c.key];
                        else w[c.key] = Math.max(0, Math.min(100, Number(e.target.value)));
                        update(i, { criteriaWeights: w });
                      }}
                    />
                  </label>
                ))}
              </div>
            </div>
          </div>
        </SectionCard>
      ))}

      {editable && (
        <div className="flex justify-end">
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending && <Loader2 className="animate-spin" />} Salvar ofertas
          </Button>
        </div>
      )}
    </div>
  );
}
