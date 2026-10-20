"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarClock, CheckSquare, Flag, Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/page";
import { api, errorMessage } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { PRIORITY_LABEL } from "@/lib/labels";
import { cn } from "@/lib/utils";
import type { Page } from "@/lib/types";
import { useNow } from "@/lib/hooks";

export type Task = {
  id: string;
  title: string;
  description: string | null;
  type: string;
  status: "OPEN" | "DONE" | "CANCELLED";
  priority: "LOW" | "MEDIUM" | "HIGH";
  dueAt: string | null;
  company: { id: string; name: string } | null;
  deal: { id: string; title: string } | null;
  assignee: { id: string; name: string } | null;
};

export function TaskComposer({ companyId, dealId, onCreated }: { companyId?: string; dealId?: string; onCreated?: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [priority, setPriority] = useState("MEDIUM");
  const create = useMutation({
    mutationFn: () => api("/tasks", { method: "POST", body: { title, companyId, dealId, priority, dueAt: due ? new Date(due).toISOString() : undefined } }),
    onSuccess: () => {
      toast.success("Tarefa criada");
      setTitle("");
      setDue("");
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["tasks-summary"] });
      onCreated?.();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (title.trim()) create.mutate();
      }}
    >
      <Input className="h-9 min-w-56 flex-1" placeholder="Nova tarefa (ex.: Retornar ligação)" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Título da tarefa" />
      <Input className="h-9 w-52" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Prazo e lembrete" />
      <Select value={priority} onValueChange={setPriority}>
        <SelectTrigger className="h-9 w-28" aria-label="Prioridade">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {Object.entries(PRIORITY_LABEL).map(([v, l]) => (
            <SelectItem key={v} value={v}>
              {l}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button type="submit" disabled={!title.trim() || create.isPending}>
        {create.isPending ? <Loader2 className="animate-spin" /> : <Plus />} Adicionar
      </Button>
    </form>
  );
}

export function TaskList({ query, showCompany = true, emptyText }: { query: Record<string, unknown>; showCompany?: boolean; emptyText?: string }) {
  const now = useNow();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["tasks", query], queryFn: () => api<Page<Task>>("/tasks", { query }) });
  const update = useMutation({
    mutationFn: ({ id, ...body }: { id: string; status?: string }) => api(`/tasks/${id}`, { method: "PATCH", body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["tasks-summary"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/tasks/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks"] }),
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (q.isLoading)
    return (
      <div className="grid gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-14" />
        ))}
      </div>
    );
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  if (!q.data?.items.length) return <EmptyState icon={CheckSquare} title={emptyText ?? "Nenhuma tarefa"} description="Crie tarefas com prazo para receber lembretes." />;

  return (
    <ul className="card-soft divide-y">
      {q.data.items.map((t) => {
        const overdue = t.status === "OPEN" && t.dueAt && new Date(t.dueAt).getTime() < now;
        return (
          <li key={t.id} className="group flex items-start gap-3 px-4 py-3">
            <Checkbox
              className="mt-0.5"
              checked={t.status === "DONE"}
              onCheckedChange={(v) => update.mutate({ id: t.id, status: v ? "DONE" : "OPEN" })}
              aria-label={t.status === "DONE" ? "Reabrir tarefa" : "Concluir tarefa"}
            />
            <div className="min-w-0 flex-1">
              <div className={cn("text-sm font-medium", t.status === "DONE" && "text-muted-foreground line-through")}>{t.title}</div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                {t.dueAt && (
                  <span className={cn("inline-flex items-center gap-1", overdue && "font-medium text-destructive")}>
                    <CalendarClock className="size-3" /> {overdue ? "Atrasada · " : ""}
                    {fmtDateTime(t.dueAt)}
                  </span>
                )}
                {t.priority !== "MEDIUM" && (
                  <span className={cn("inline-flex items-center gap-1", t.priority === "HIGH" && "text-warning")}>
                    <Flag className="size-3" /> {PRIORITY_LABEL[t.priority]}
                  </span>
                )}
                {showCompany && t.company && (
                  <Link href={`/empresas/${t.company.id}`} className="text-primary hover:underline">
                    {t.company.name}
                  </Link>
                )}
                {t.assignee && <span>{t.assignee.name}</span>}
              </div>
            </div>
            <Button variant="ghost" size="icon-sm" className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100" aria-label="Excluir tarefa" onClick={() => remove.mutate(t.id)}>
              <Trash2 />
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
