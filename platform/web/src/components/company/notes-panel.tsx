"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, NotebookPen, Pin, PinOff, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/page";
import { api, errorMessage } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { useSession } from "@/lib/session";

type Note = { id: string; body: string; pinned: boolean; createdAt: string; author: { id: string; name: string } | null };

export function NotesPanel({ companyId }: { companyId: string }) {
  const qc = useQueryClient();
  const { session, can } = useSession();
  const [body, setBody] = useState("");
  const q = useQuery({ queryKey: ["notes", companyId], queryFn: () => api<Note[]>(`/companies/${companyId}/notes`) });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["notes", companyId] });
    qc.invalidateQueries({ queryKey: ["timeline", companyId] });
  };
  const create = useMutation({
    mutationFn: () => api(`/companies/${companyId}/notes`, { method: "POST", body: { body } }),
    onSuccess: () => {
      setBody("");
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const update = useMutation({ mutationFn: ({ id, pinned }: { id: string; pinned: boolean }) => api(`/notes/${id}`, { method: "PATCH", body: { pinned } }), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (id: string) => api(`/notes/${id}`, { method: "DELETE" }), onSuccess: refresh, onError: (e) => toast.error(errorMessage(e)) });

  return (
    <div className="grid gap-4">
      {can("crm:write") && (
        <div className="card-soft grid gap-2 p-4">
          <Textarea rows={3} placeholder="Escreva uma anotação…" value={body} onChange={(e) => setBody(e.target.value)} aria-label="Nova anotação" />
          <Button size="sm" className="justify-self-end" disabled={!body.trim() || create.isPending} onClick={() => create.mutate()}>
            {create.isPending && <Loader2 className="animate-spin" />} Salvar anotação
          </Button>
        </div>
      )}
      {!q.data?.length ? (
        <EmptyState icon={NotebookPen} title="Sem anotações" />
      ) : (
        <ul className="grid gap-3">
          {q.data.map((n) => (
            <li key={n.id} className={`card-soft group p-4 ${n.pinned ? "border-primary/40" : ""}`}>
              <p className="text-sm whitespace-pre-line">{n.body}</p>
              <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                {n.pinned && <Pin className="size-3 text-primary" />}
                {n.author?.name ?? "—"} · {fmtDateTime(n.createdAt)}
                <div className="ml-auto flex gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                  <Button variant="ghost" size="icon-xs" aria-label={n.pinned ? "Desafixar" : "Fixar"} onClick={() => update.mutate({ id: n.id, pinned: !n.pinned })}>
                    {n.pinned ? <PinOff /> : <Pin />}
                  </Button>
                  {(n.author?.id === session?.user.id || can("settings:manage")) && (
                    <Button variant="ghost" size="icon-xs" aria-label="Excluir anotação" onClick={() => remove.mutate(n.id)}>
                      <Trash2 />
                    </Button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
