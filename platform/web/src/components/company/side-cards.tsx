"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { KanbanSquare, Loader2, Plus, Tag, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SectionCard } from "@/components/page";
import { ScorePill } from "@/components/score-pill";
import { StatusBadge } from "@/components/status-badge";
import { api, errorMessage } from "@/lib/api";
import { fmtDateTime, fmtMoney } from "@/lib/format";
import { SCORE_LABEL } from "@/lib/labels";
import type { CompanyDetail } from "./types";

type Pipeline = { id: string; name: string; stages: { id: string; name: string; kind: string; position: number }[] };

export function ScoresCard({ company }: { company: CompanyDetail }) {
  const kinds = ["DATA_QUALITY", "GOOGLE_PRESENCE", "WEBSITE_QUALITY", "MULTICHANNEL", "OPPORTUNITY"];
  const audit = company.audits[0];
  return (
    <SectionCard
      title="Indicadores"
      description={audit?.finishedAt ? `Auditoria de ${fmtDateTime(audit.finishedAt)}` : "Gere uma auditoria para calcular"}
      actions={
        audit && (
          <Link href={`/auditorias/${audit.id}`} className="text-xs text-primary hover:underline">
            Ver relatório
          </Link>
        )
      }
    >
      <ul className="grid gap-2.5">
        {kinds.map((k) => {
          const s = company.scores.find((x) => x.kind === k);
          return (
            <li key={k} className="flex items-center justify-between gap-2 text-sm">
              <span className="text-muted-foreground">{SCORE_LABEL[k]}</span>
              <ScorePill score={s?.score ?? null} confidence={s?.confidence} label={SCORE_LABEL[k]} />
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-[11px] text-muted-foreground">Estimativas internas baseadas em dados públicos acessíveis — não são auditorias oficiais do Google.</p>
    </SectionCard>
  );
}

export function CrmCard({ company, canWrite }: { company: CompanyDetail; canWrite: boolean }) {
  const qc = useQueryClient();
  const pipelines = useQuery({ queryKey: ["pipelines"], queryFn: () => api<Pipeline[]>("/pipelines"), staleTime: 60_000 });
  const open = company.deals.find((d) => d.status === "OPEN") ?? company.deals[0];
  const [value, setValue] = useState(open?.valueCents != null ? String(open.valueCents / 100) : "");
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["company", company.id] });
    qc.invalidateQueries({ queryKey: ["timeline", company.id] });
    qc.invalidateQueries({ queryKey: ["deals"] });
  };
  const create = useMutation({
    mutationFn: () => api("/deals", { method: "POST", body: { companyId: company.id } }),
    onSuccess: () => {
      toast.success("Lead enviado ao CRM");
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) => api(`/deals/${open!.id}`, { method: "PATCH", body }),
    onSuccess: () => refresh(),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const stages = pipelines.data?.find((p) => p.id === open?.pipeline.id)?.stages ?? pipelines.data?.[0]?.stages ?? [];

  return (
    <SectionCard
      title="CRM"
      actions={
        <Link href="/crm" className="text-xs text-primary hover:underline">
          Abrir pipeline
        </Link>
      }
    >
      {!open ? (
        <div className="grid gap-3">
          <p className="text-sm text-muted-foreground">Este lead ainda não está no pipeline comercial.</p>
          {canWrite && (
            <Button onClick={() => create.mutate()} disabled={create.isPending}>
              {create.isPending ? <Loader2 className="animate-spin" /> : <KanbanSquare />} Adicionar ao CRM
            </Button>
          )}
        </div>
      ) : (
        <div className="grid gap-3 text-sm">
          <div className="grid gap-1.5">
            <span className="text-xs text-muted-foreground">Etapa</span>
            <Select value={open.stageId} onValueChange={(stageId) => patch.mutate({ stageId })} disabled={!canWrite}>
              <SelectTrigger className="w-full" aria-label="Etapa do pipeline">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {stages.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <span className="text-xs text-muted-foreground">Valor estimado (R$)</span>
            <div className="flex gap-2">
              <Input type="number" min={0} step="100" value={value} onChange={(e) => setValue(e.target.value)} disabled={!canWrite} aria-label="Valor estimado em reais" />
              <Button
                variant="outline"
                disabled={!canWrite || patch.isPending}
                onClick={() => patch.mutate({ valueCents: value === "" ? null : Math.round(Number(value) * 100) })}
              >
                Salvar
              </Button>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Situação</span>
            <StatusBadge tone={open.status === "WON" ? "success" : open.status === "LOST" ? "danger" : "progress"}>
              {{ OPEN: "Em andamento", WON: "Ganha", LOST: "Perdida", ARCHIVED: "Arquivada" }[open.status]}
            </StatusBadge>
          </div>
          {open.valueCents != null && <div className="text-xs text-muted-foreground">Pipeline: {fmtMoney(open.valueCents)}</div>}
          {open.owner && <div className="text-xs text-muted-foreground">Responsável: {open.owner.name}</div>}
        </div>
      )}
    </SectionCard>
  );
}

export function TagsCard({ company, canWrite }: { company: CompanyDetail; canWrite: boolean }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const refresh = () => qc.invalidateQueries({ queryKey: ["company", company.id] });
  const add = useMutation({
    mutationFn: () => api(`/companies/${company.id}/tags`, { method: "POST", body: { name } }),
    onSuccess: () => {
      setName("");
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({ mutationFn: (tagId: string) => api(`/companies/${company.id}/tags/${tagId}`, { method: "DELETE" }), onSuccess: refresh });
  return (
    <SectionCard title="Etiquetas e listas">
      <div className="flex flex-wrap gap-1.5">
        {company.tags.map(({ tag }) => (
          <span key={tag.id} className="inline-flex items-center gap-1 rounded-md bg-accent px-2 py-0.5 text-xs text-accent-foreground">
            <Tag className="size-3" /> {tag.name}
            {canWrite && (
              <button type="button" onClick={() => remove.mutate(tag.id)} aria-label={`Remover etiqueta ${tag.name}`} className="opacity-60 hover:opacity-100">
                <X className="size-3" />
              </button>
            )}
          </span>
        ))}
        {!company.tags.length && <span className="text-xs text-muted-foreground">Sem etiquetas</span>}
      </div>
      {canWrite && (
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) add.mutate();
          }}
        >
          <Input className="h-8" placeholder="Nova etiqueta" value={name} onChange={(e) => setName(e.target.value)} aria-label="Nova etiqueta" />
          <Button size="sm" variant="outline" type="submit" disabled={!name.trim()}>
            <Plus />
          </Button>
        </form>
      )}
      {company.listItems.length > 0 && (
        <div className="mt-4 grid gap-1">
          <span className="text-xs text-muted-foreground">Listas</span>
          {company.listItems.map(({ list }) => (
            <Link key={list.id} href={`/listas/${list.id}`} className="text-sm text-primary hover:underline">
              {list.name}
            </Link>
          ))}
        </div>
      )}
    </SectionCard>
  );
}
