"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, CheckCheck, Clock, FileText, Loader2, Send, ShieldAlert, ShieldCheck, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/page";
import { api, errorMessage } from "@/lib/api";
import { fmtDateTime, fmtPhone } from "@/lib/format";
import { MESSAGE_STATUS_LABEL } from "@/lib/labels";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";
import { ConsentDialog } from "./consent-dialog";

type Msg = { id: string; direction: "INBOUND" | "OUTBOUND"; body: string; status: string; error: string | null; createdAt: string; sentAt: string | null; sentBy: { name: string } | null; approvedBy: { name: string } | null };
type Decision = { allowed: true; basis: string; requiresApproval: boolean; detail: string } | { allowed: false; reason: string; detail: string };
export type ConversationDetail = {
  id: string;
  contactPhone: string;
  contactName: string | null;
  status: string;
  company: { id: string; name: string } | null;
  messagingAccount: { id: string; name: string; status: string; provider: string };
  messages: Msg[];
  decision: Decision;
  consent: { status: string; source: string; grantedAt: string | null; revokedAt: string | null; legalBasis: string } | null;
};

function StatusIcon({ status }: { status: string }) {
  if (status === "READ") return <CheckCheck className="size-3.5 text-sky-500" />;
  if (status === "DELIVERED") return <CheckCheck className="size-3.5" />;
  if (status === "SENT") return <Check className="size-3.5" />;
  if (status === "FAILED" || status === "BLOCKED") return <XCircle className="size-3.5 text-destructive" />;
  return <Clock className="size-3.5" />;
}

export function Thread({ conversationId }: { conversationId: string }) {
  const qc = useQueryClient();
  const { can } = useSession();
  const [body, setBody] = useState("");
  const [key, setKey] = useState(() => crypto.randomUUID());
  const endRef = useRef<HTMLDivElement>(null);
  const q = useQuery({ queryKey: ["conversation", conversationId], queryFn: () => api<ConversationDetail>(`/conversations/${conversationId}`), refetchInterval: 4000 });
  const templates = useQuery({ queryKey: ["templates"], queryFn: () => api<{ id: string; name: string; isActive: boolean }[]>("/message-templates"), staleTime: 60_000 });

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [q.data?.messages.length]);
  useEffect(() => {
    qc.invalidateQueries({ queryKey: ["conversations"] });
  }, [conversationId, qc]);

  const send = useMutation({
    mutationFn: () => api<{ status: string }>(`/conversations/${conversationId}/messages`, { method: "POST", body: { body, idempotencyKey: key } }),
    onSuccess: (m) => {
      setBody("");
      setKey(crypto.randomUUID());
      if (m.status === "PENDING_APPROVAL") toast.message("Mensagem enviada para aprovação de um gestor");
      qc.invalidateQueries({ queryKey: ["conversation", conversationId] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
    },
    onError: (e) => toast.error("Envio não permitido", { description: errorMessage(e) }),
  });
  const applyTemplate = async (id: string) => {
    try {
      const r = await api<{ body: string }>(`/message-templates/${id}/render`, { method: "POST", body: { conversationId } });
      setBody(r.body);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  if (!q.data) return <Skeleton className="h-full min-h-96" />;
  const c = q.data;
  const d = c.decision;
  const connected = c.messagingAccount.status === "CONNECTED";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b px-5 py-3">
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{c.contactName ?? fmtPhone(c.contactPhone)}</div>
          <div className="text-xs text-muted-foreground">
            {fmtPhone(c.contactPhone)} ·{" "}
            {c.company ? (
              <Link href={`/empresas/${c.company.id}`} className="text-primary hover:underline">
                {c.company.name}
              </Link>
            ) : (
              "sem lead vinculado"
            )}{" "}
            · via {c.messagingAccount.name}
          </div>
        </div>
        {can("consent:manage") && <ConsentDialog phone={c.contactPhone} companyId={c.company?.id} />}
      </header>

      <div className={cn("flex items-start gap-2 border-b px-5 py-2 text-xs", d.allowed ? "bg-success-soft/50" : "bg-warning-soft/60")} role="status">
        {d.allowed ? <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-success" /> : <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-warning" />}
        <span>
          {d.allowed ? (d.basis === "CUSTOMER_INITIATED" ? "Pode responder: " : d.requiresApproval ? "Autorizado com aprovação de gestor: " : "Autorizado: ") : "Envio bloqueado: "}
          {d.detail}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        {!c.messages.length && <p className="py-10 text-center text-sm text-muted-foreground">Nenhuma mensagem ainda.</p>}
        <ul className="grid gap-2">
          {c.messages.map((m) => (
            <li key={m.id} className={cn("flex", m.direction === "OUTBOUND" ? "justify-end" : "justify-start")}>
              <div className={cn("max-w-[78%] rounded-2xl px-3.5 py-2 text-sm shadow-[0_1px_1px_rgb(0_0_0/0.04)]", m.direction === "OUTBOUND" ? "rounded-br-md bg-accent text-accent-foreground" : "rounded-bl-md border bg-card")}>
                <p className="whitespace-pre-wrap break-words">{m.body}</p>
                <div className="mt-1 flex items-center justify-end gap-1 text-[10px] opacity-70">
                  {m.sentBy && <span>{m.sentBy.name.split(" ")[0]} ·</span>}
                  {fmtDateTime(m.sentAt ?? m.createdAt)}
                  {m.direction === "OUTBOUND" && <StatusIcon status={m.status} />}
                </div>
                {m.direction === "OUTBOUND" && !["SENT", "DELIVERED", "READ"].includes(m.status) && (
                  <div className={cn("mt-0.5 text-right text-[10px]", m.status === "FAILED" || m.status === "BLOCKED" ? "text-destructive" : "opacity-70")}>
                    {MESSAGE_STATUS_LABEL[m.status]}
                    {m.error ? ` — ${m.error}` : ""}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
        <div ref={endRef} />
      </div>

      {can("messages:send") && (
        <form
          className="grid gap-2 border-t p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (body.trim()) send.mutate();
          }}
        >
          <div className="flex items-center gap-2">
            <Select onValueChange={applyTemplate}>
              <SelectTrigger className="h-8 w-52" aria-label="Usar modelo">
                <FileText className="size-3.5" />
                <SelectValue placeholder="Usar modelo…" />
              </SelectTrigger>
              <SelectContent>
                {templates.data
                  ?.filter((t) => t.isActive)
                  .map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            {!connected && <span className="text-xs text-destructive">WhatsApp desconectado</span>}
          </div>
          <div className="flex items-end gap-2">
            <Textarea
              rows={2}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={d.allowed ? "Escreva uma mensagem…" : "Envio bloqueado pelas regras de consentimento"}
              disabled={!d.allowed || !connected}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && body.trim()) send.mutate();
              }}
              aria-label="Mensagem"
            />
            <Button type="submit" disabled={!d.allowed || !connected || !body.trim() || send.isPending} aria-label="Enviar">
              {send.isPending ? <Loader2 className="animate-spin" /> : <Send />}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">Envio individual e manual. Ctrl + Enter envia. Pedidos como “parar” ou “sair” bloqueiam o número automaticamente.</p>
        </form>
      )}
    </div>
  );
}
