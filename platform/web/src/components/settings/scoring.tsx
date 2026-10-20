"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionCard } from "@/components/page";
import { api, errorMessage } from "@/lib/api";
import { SCORE_LABEL } from "@/lib/labels";
import { useSession } from "@/lib/session";
import { useSyncedState } from "@/lib/hooks";

type Criterion = { key: string; dimension: string; label: string; weight: number; defaultWeight: number };

export function ScoringSettings() {
  const qc = useQueryClient();
  const { can } = useSession();
  const q = useQuery({ queryKey: ["scoring-criteria"], queryFn: () => api<{ version: string; minConfidence: number; criteria: Criterion[] }>("/scoring/criteria") });
  const [weights, setWeights] = useSyncedState(q.data, (d): Record<string, number> => (d ? Object.fromEntries(d.criteria.map((c) => [c.key, c.weight])) : {}));
  const save = useMutation({
    mutationFn: () => {
      const scoring: Record<string, Record<string, number>> = {};
      for (const c of q.data!.criteria) {
        if (weights[c.key] !== c.defaultWeight) (scoring[c.dimension] ??= {})[c.key] = weights[c.key]!;
      }
      return api("/org", { method: "PATCH", body: { settings: { scoring } } });
    },
    onSuccess: () => {
      toast.success("Pesos salvos", { description: "Valem para as próximas auditorias." });
      qc.invalidateQueries({ queryKey: ["scoring-criteria"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (!q.data) return null;
  const editable = can("settings:manage");
  const dims = [...new Set(q.data.criteria.map((c) => c.dimension))];
  return (
    <div className="grid gap-6">
      <SectionCard title="Metodologia" description={`Versão ${q.data.version}`}>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>Cada critério recebe 100% (atende), 50% (parcial) ou 0% (não atende) do seu peso.</li>
          <li>Critérios sem dados acessíveis ficam “Não avaliado” e saem do numerador e do denominador.</li>
          <li>A confiança é a fração do peso total efetivamente avaliada; abaixo de {Math.round(q.data.minConfidence * 100)}% a dimensão inteira fica “Não avaliado”.</li>
          <li>Em “Oportunidade comercial”, atender significa que existe uma oportunidade comprovada por evidência.</li>
        </ul>
      </SectionCard>
      <div className="grid gap-6 lg:grid-cols-2">
        {dims.map((d) => (
          <SectionCard key={d} title={SCORE_LABEL[d]} bodyClassName="p-0">
            <ul className="divide-y">
              {q.data.criteria
                .filter((c) => c.dimension === d)
                .map((c) => (
                  <li key={c.key} className="flex items-center gap-3 px-5 py-2">
                    <span className="flex-1 text-sm">{c.label}</span>
                    {weights[c.key] !== c.defaultWeight && <span className="text-[11px] text-muted-foreground">padrão {c.defaultWeight}</span>}
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      className="h-8 w-20"
                      value={weights[c.key] ?? c.weight}
                      disabled={!editable}
                      onChange={(e) => setWeights((w) => ({ ...w, [c.key]: Math.max(0, Math.min(100, Number(e.target.value))) }))}
                      aria-label={`Peso de ${c.label}`}
                    />
                  </li>
                ))}
            </ul>
          </SectionCard>
        ))}
      </div>
      {editable && (
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setWeights(Object.fromEntries(q.data!.criteria.map((c) => [c.key, c.defaultWeight])))}>
            <RotateCcw /> Restaurar padrões
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending && <Loader2 className="animate-spin" />} Salvar pesos
          </Button>
        </div>
      )}
    </div>
  );
}
