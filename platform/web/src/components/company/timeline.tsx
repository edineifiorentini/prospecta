"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowRightLeft, Building2, CalendarClock, CheckSquare, FileSearch, Handshake, Loader2, Mail, MessageCircle, NotebookPen, Pencil, Phone, ShieldCheck, Sparkles, Upload, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/page";
import { api, errorMessage } from "@/lib/api";
import { ACTIVITY_LABEL } from "@/lib/labels";
import { fmtDateTime, fmtRelative } from "@/lib/format";

type Activity = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  metadata: Record<string, unknown>;
  occurredAt: string;
  user: { id: string; name: string } | null;
  deal: { id: string; title: string } | null;
};

const ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  CALL: Phone, MEETING: Users, EMAIL: Mail, NOTE: NotebookPen, WHATSAPP: MessageCircle, STAGE_CHANGE: ArrowRightLeft, TASK: CheckSquare, DEAL: Handshake,
  IMPORT: Upload, ENRICHMENT: Sparkles, AUDIT: FileSearch, FIELD_CHANGE: Pencil, CONSENT: ShieldCheck, SYSTEM: Building2,
};

const OUTCOME: Record<string, string> = { CONNECTED: "Atendeu", NO_ANSWER: "Não atendeu", VOICEMAIL: "Caixa postal", WRONG_NUMBER: "Número errado", SCHEDULED: "Agendado", DONE: "Realizada", CANCELLED: "Cancelada", OTHER: "Outro" };

function ActivityComposer({ companyId, onDone }: { companyId: string; onDone: () => void }) {
  const [type, setType] = useState<"CALL" | "MEETING" | "EMAIL" | "NOTE">("CALL");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [duration, setDuration] = useState("");
  const [outcome, setOutcome] = useState<string>("CONNECTED");
  const [when, setWhen] = useState("");
  const save = useMutation({
    mutationFn: () =>
      api("/activities", {
        method: "POST",
        body: {
          companyId,
          type,
          title: title || { CALL: "Ligação", MEETING: "Reunião", EMAIL: "E-mail enviado", NOTE: "Anotação" }[type],
          body: body || undefined,
          durationMin: duration ? Number(duration) : undefined,
          outcome: type === "CALL" || type === "MEETING" ? outcome : undefined,
          occurredAt: when ? new Date(when).toISOString() : undefined,
        },
      }),
    onSuccess: () => {
      toast.success("Registrado na linha do tempo");
      setTitle("");
      setBody("");
      setDuration("");
      onDone();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div className="card-soft grid gap-3 p-4">
      <ToggleGroup type="single" variant="outline" size="sm" spacing={0} value={type} onValueChange={(v) => v && setType(v as typeof type)} className="justify-start">
        <ToggleGroupItem value="CALL" className="px-3 text-xs">
          <Phone /> Ligação
        </ToggleGroupItem>
        <ToggleGroupItem value="MEETING" className="px-3 text-xs">
          <Users /> Reunião
        </ToggleGroupItem>
        <ToggleGroupItem value="EMAIL" className="px-3 text-xs">
          <Mail /> E-mail
        </ToggleGroupItem>
        <ToggleGroupItem value="NOTE" className="px-3 text-xs">
          <NotebookPen /> Nota
        </ToggleGroupItem>
      </ToggleGroup>
      <Input placeholder="Resumo (ex.: Conversa com a recepção)" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Resumo da atividade" />
      <Textarea placeholder="Detalhes, próximos passos…" rows={2} value={body} onChange={(e) => setBody(e.target.value)} aria-label="Detalhes da atividade" />
      <div className="flex flex-wrap items-center gap-2">
        {(type === "CALL" || type === "MEETING") && (
          <>
            <Select value={outcome} onValueChange={setOutcome}>
              <SelectTrigger className="h-8 w-40" aria-label="Resultado">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(OUTCOME).map(([v, l]) => (
                  <SelectItem key={v} value={v}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input className="h-8 w-28" type="number" min={0} placeholder="Minutos" value={duration} onChange={(e) => setDuration(e.target.value)} aria-label="Duração em minutos" />
          </>
        )}
        <Input className="h-8 w-52" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} aria-label="Quando aconteceu" />
        <Button size="sm" className="ml-auto" onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending && <Loader2 className="animate-spin" />} Registrar
        </Button>
      </div>
    </div>
  );
}

export function Timeline({ companyId, canWrite }: { companyId: string; canWrite: boolean }) {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<string>("all");
  const q = useQuery({ queryKey: ["timeline", companyId, filter], queryFn: () => api<Activity[]>(`/companies/${companyId}/timeline`, { query: { type: filter === "all" ? undefined : filter } }) });
  return (
    <div className="grid gap-4">
      {canWrite && <ActivityComposer companyId={companyId} onDone={() => qc.invalidateQueries({ queryKey: ["timeline", companyId] })} />}
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Mostrar</span>
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="h-8 w-48" aria-label="Filtrar atividades">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tudo</SelectItem>
            {["CALL", "MEETING", "EMAIL", "NOTE", "WHATSAPP", "STAGE_CHANGE", "TASK", "DEAL", "ENRICHMENT", "AUDIT", "FIELD_CHANGE", "CONSENT"].map((t) => (
              <SelectItem key={t} value={t}>
                {ACTIVITY_LABEL[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {q.isLoading ? (
        <div className="grid gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </div>
      ) : !q.data?.length ? (
        <EmptyState icon={CalendarClock} title="Nenhuma atividade" description="Ligações, reuniões, mudanças de etapa e alterações aparecem aqui." />
      ) : (
        <ol className="relative grid gap-0 border-l pl-6">
          {q.data.map((a) => {
            const Icon = ICON[a.type] ?? Building2;
            const meta = a.metadata ?? {};
            const diff = meta.diff as Record<string, { from: unknown; to: unknown }> | undefined;
            return (
              <li key={a.id} className="relative pb-5">
                <span className="absolute top-0 -left-[37px] flex size-7 items-center justify-center rounded-full border bg-card text-muted-foreground">
                  <Icon className="size-3.5" />
                </span>
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-sm font-medium">{a.title}</span>
                  <span className="text-xs text-muted-foreground" title={fmtDateTime(a.occurredAt)}>
                    {fmtRelative(a.occurredAt)}
                    {a.user && ` · ${a.user.name}`}
                  </span>
                </div>
                {Boolean(meta.outcome || meta.durationMin) && (
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {meta.outcome ? OUTCOME[String(meta.outcome)] : ""}
                    {meta.durationMin ? ` · ${String(meta.durationMin)} min` : ""}
                  </div>
                )}
                {a.body && <p className="mt-1 text-sm whitespace-pre-line text-muted-foreground">{a.body}</p>}
                {diff && (
                  <ul className="mt-1 grid gap-0.5 text-xs text-muted-foreground">
                    {Object.entries(diff).map(([k, v]) => (
                      <li key={k}>
                        <span className="font-medium text-foreground">{k}</span>: {String(v.from ?? "—")} → {String(v.to ?? "—")}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
