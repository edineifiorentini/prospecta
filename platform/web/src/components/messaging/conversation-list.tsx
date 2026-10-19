"use client";

import { useQuery } from "@tanstack/react-query";
import { MessageCircle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { fmtPhone, fmtRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

export type ConversationRow = {
  id: string;
  contactPhone: string;
  contactName: string | null;
  status: string;
  unreadCount: number;
  lastMessageAt: string | null;
  company: { id: string; name: string } | null;
  lastMessage: { body: string; direction: string; status: string; createdAt: string } | null;
};

export function ConversationList({ query, selected, onSelect }: { query: Record<string, unknown>; selected?: string | null; onSelect: (id: string) => void }) {
  const q = useQuery({ queryKey: ["conversations", query], queryFn: () => api<ConversationRow[]>("/conversations", { query }), refetchInterval: 5000 });
  if (q.isLoading)
    return (
      <div className="grid gap-2 p-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-14" />
        ))}
      </div>
    );
  if (!q.data?.length)
    return (
      <div className="flex flex-col items-center gap-2 px-6 py-12 text-center text-sm text-muted-foreground">
        <MessageCircle className="size-6" /> Nenhuma conversa ainda.
      </div>
    );
  return (
    <ul className="divide-y">
      {q.data.map((c) => (
        <li key={c.id}>
          <button type="button" onClick={() => onSelect(c.id)} className={cn("flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-muted/60", selected === c.id && "bg-accent/60")} aria-current={selected === c.id}>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium">{c.contactName ?? fmtPhone(c.contactPhone)}</span>
                {c.status === "OPTED_OUT" && <span className="rounded bg-danger-soft px-1 text-[10px] text-destructive">opt-out</span>}
              </div>
              <div className="truncate text-xs text-muted-foreground">{c.company?.name ?? fmtPhone(c.contactPhone)}</div>
              {c.lastMessage && (
                <div className="mt-0.5 truncate text-xs text-muted-foreground">
                  {c.lastMessage.direction === "OUTBOUND" ? "Você: " : ""}
                  {c.lastMessage.body}
                </div>
              )}
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <span className="text-[10px] text-muted-foreground">{fmtRelative(c.lastMessageAt)}</span>
              {c.unreadCount > 0 && <span className="num rounded-full bg-primary px-1.5 text-[10px] text-primary-foreground">{c.unreadCount}</span>}
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}
