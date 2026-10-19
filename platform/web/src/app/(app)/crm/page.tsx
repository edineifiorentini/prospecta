"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { KanbanSquare, Search as SearchIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState, PageHeader } from "@/components/page";
import { KanbanBoard, type KanbanDeal, type KanbanStage } from "@/components/crm/kanban";
import { StagesDialog } from "@/components/crm/stages-dialog";
import { api, errorMessage } from "@/lib/api";
import { fmtMoney } from "@/lib/format";
import { useSession } from "@/lib/session";

type Pipeline = { id: string; name: string; stages: (KanbanStage & { _count: { deals: number } })[] };

export default function CrmPage() {
  const qc = useQueryClient();
  const { can } = useSession();
  const [q, setQ] = useState("");
  const [owner, setOwner] = useState<string>("all");
  const [lostPrompt, setLostPrompt] = useState<{ dealId: string; stageId: string; position: number } | null>(null);
  const [lostReason, setLostReason] = useState("");

  const pipelines = useQuery({ queryKey: ["pipelines"], queryFn: () => api<Pipeline[]>("/pipelines") });
  const pipeline = pipelines.data?.[0];
  const facets = useQuery({ queryKey: ["company-facets"], queryFn: () => api<{ owners: { id: string; name: string }[] }>("/companies/facets"), staleTime: 60_000 });
  const deals = useQuery({
    queryKey: ["deals", pipeline?.id, q, owner],
    queryFn: () => api<{ pipelineId: string; deals: KanbanDeal[] }>("/deals", { query: { pipelineId: pipeline!.id, q: q || undefined, ownerId: owner === "all" ? undefined : owner } }),
    enabled: !!pipeline,
    placeholderData: (p) => p,
  });

  const move = useMutation({
    mutationFn: ({ dealId, ...body }: { dealId: string; stageId: string; position: number; lostReason?: string }) => api(`/deals/${dealId}`, { method: "PATCH", body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["deals"] });
      qc.invalidateQueries({ queryKey: ["pipelines"] });
    },
    onError: (e) => {
      toast.error("Não foi possível mover", { description: errorMessage(e) });
      qc.invalidateQueries({ queryKey: ["deals"] });
    },
  });

  const totals = useMemo(() => {
    const open = (deals.data?.deals ?? []).filter((d) => d.status === "OPEN");
    return { count: open.length, value: open.reduce((s, d) => s + (d.valueCents ?? 0), 0) };
  }, [deals.data]);

  if (pipelines.isError) return <ErrorState message={errorMessage(pipelines.error)} onRetry={() => pipelines.refetch()} />;

  return (
    <>
      <PageHeader
        title="CRM"
        description={pipeline ? `${pipeline.name} · ${totals.count} negociação(ões) abertas · ${fmtMoney(totals.value)} em pipeline` : undefined}
        actions={pipeline && can("settings:manage") && <StagesDialog pipelineId={pipeline.id} stages={pipeline.stages} />}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative w-64">
          <SearchIcon className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar empresa ou negociação" className="h-8 pl-8" aria-label="Buscar no pipeline" />
        </div>
        <Select value={owner} onValueChange={setOwner}>
          <SelectTrigger className="h-8 w-48" aria-label="Filtrar por responsável">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os responsáveis</SelectItem>
            {facets.data?.owners.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">Arraste os cartões entre etapas (também funciona com teclado: espaço + setas).</span>
      </div>
      {!pipeline || deals.isLoading ? (
        <div className="flex gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-96 w-72 shrink-0 rounded-xl" />
          ))}
        </div>
      ) : !deals.data?.deals.length && !q && owner === "all" ? (
        <EmptyState icon={KanbanSquare} title="Pipeline vazio" description="Envie empresas ao CRM a partir dos resultados de busca, da lista de empresas ou da ficha de cada empresa." />
      ) : (
        <KanbanBoard
          stages={pipeline.stages}
          deals={deals.data?.deals ?? []}
          onMove={(dealId, stageId, position, toStage) => {
            if (toStage.kind === "LOST") {
              setLostReason("");
              setLostPrompt({ dealId, stageId, position });
              return;
            }
            move.mutate({ dealId, stageId, position });
            if (toStage.kind === "WON") toast.success("Negociação ganha! 🎉");
          }}
        />
      )}

      <Dialog open={!!lostPrompt} onOpenChange={(o) => !o && (setLostPrompt(null), qc.invalidateQueries({ queryKey: ["deals"] }))}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Motivo da perda</DialogTitle>
            <DialogDescription>Registrar o motivo ajuda a entender o funil.</DialogDescription>
          </DialogHeader>
          <Textarea autoFocus value={lostReason} onChange={(e) => setLostReason(e.target.value)} placeholder="Ex.: sem orçamento, escolheu concorrente…" aria-label="Motivo da perda" />
          <DialogFooter>
            <Button
              onClick={() => {
                if (lostPrompt) move.mutate({ ...lostPrompt, lostReason: lostReason || undefined });
                setLostPrompt(null);
              }}
            >
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
