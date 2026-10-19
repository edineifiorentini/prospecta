"use client";

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Loader2, Plus, Settings2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, errorMessage } from "@/lib/api";
import type { KanbanStage } from "./kanban";

export function StagesDialog({ pipelineId, stages }: { pipelineId: string; stages: (KanbanStage & { _count?: { deals: number } })[] }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [order, setOrder] = useState(stages);
  const [name, setName] = useState("");
  useEffect(() => setOrder(stages), [stages]);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["pipelines"] });
    qc.invalidateQueries({ queryKey: ["deals"] });
  };
  const add = useMutation({
    mutationFn: () => api(`/pipelines/${pipelineId}/stages`, { method: "POST", body: { name } }),
    onSuccess: () => {
      setName("");
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const rename = useMutation({ mutationFn: ({ id, name }: { id: string; name: string }) => api(`/stages/${id}`, { method: "PATCH", body: { name } }), onSuccess: refresh, onError: (e) => toast.error(errorMessage(e)) });
  const reorder = useMutation({
    mutationFn: (ids: string[]) => api(`/pipelines/${pipelineId}/reorder`, { method: "POST", body: { stageIds: ids } }),
    onSuccess: refresh,
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: ({ id, moveToStageId }: { id: string; moveToStageId?: string }) => api(`/stages/${id}`, { method: "DELETE", body: { moveToStageId } }),
    onSuccess: () => {
      toast.success("Etapa removida");
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const [moveTo, setMoveTo] = useState<Record<string, string>>({});

  const move = (i: number, dir: -1 | 1) => {
    const next = [...order];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j]!, next[i]!];
    setOrder(next);
    reorder.mutate(next.map((s) => s.id));
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Settings2 /> Etapas
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Etapas do pipeline</DialogTitle>
          <DialogDescription>Renomeie, reordene, crie ou remova etapas. Etapas “Ganho” e “Perdido” encerram a negociação.</DialogDescription>
        </DialogHeader>
        <ul className="grid max-h-[50vh] gap-1.5 overflow-y-auto">
          {order.map((s, i) => (
            <li key={s.id} className="grid gap-1.5 rounded-lg border p-2">
              <div className="flex items-center gap-1.5">
                <Input
                  defaultValue={s.name}
                  className="h-8"
                  aria-label={`Nome da etapa ${s.name}`}
                  onBlur={(e) => e.target.value.trim() && e.target.value !== s.name && rename.mutate({ id: s.id, name: e.target.value.trim() })}
                />
                <span className="w-16 shrink-0 text-center text-[11px] text-muted-foreground">{s.kind === "WON" ? "ganho" : s.kind === "LOST" ? "perdido" : `${s._count?.deals ?? 0} neg.`}</span>
                <Button variant="ghost" size="icon-sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Mover para cima">
                  <ArrowUp />
                </Button>
                <Button variant="ghost" size="icon-sm" onClick={() => move(i, 1)} disabled={i === order.length - 1} aria-label="Mover para baixo">
                  <ArrowDown />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Remover etapa"
                  onClick={() => remove.mutate({ id: s.id, moveToStageId: moveTo[s.id] })}
                  disabled={remove.isPending || ((s._count?.deals ?? 0) > 0 && !moveTo[s.id])}
                  title={(s._count?.deals ?? 0) > 0 ? "Escolha para onde mover as negociações" : undefined}
                >
                  <Trash2 />
                </Button>
              </div>
              {(s._count?.deals ?? 0) > 0 && (
                <Select value={moveTo[s.id] ?? ""} onValueChange={(v) => setMoveTo((m) => ({ ...m, [s.id]: v }))}>
                  <SelectTrigger className="h-7 text-xs" aria-label="Mover negociações para">
                    <SelectValue placeholder="Para remover, mover negociações para…" />
                  </SelectTrigger>
                  <SelectContent>
                    {order
                      .filter((o) => o.id !== s.id)
                      .map((o) => (
                        <SelectItem key={o.id} value={o.id}>
                          {o.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              )}
            </li>
          ))}
        </ul>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) add.mutate();
          }}
        >
          <Input className="h-9" placeholder="Nova etapa (ex.: Diagnóstico enviado)" value={name} onChange={(e) => setName(e.target.value)} aria-label="Nome da nova etapa" />
          <Button type="submit" disabled={!name.trim() || add.isPending}>
            {add.isPending ? <Loader2 className="animate-spin" /> : <Plus />} Criar
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
