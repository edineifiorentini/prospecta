"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { MessageCircle, Search as SearchIcon, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { EmptyState, PageHeader } from "@/components/page";
import { StatusBadge } from "@/components/status-badge";
import { ConversationList } from "@/components/messaging/conversation-list";
import { Thread } from "@/components/messaging/thread";
import { api } from "@/lib/api";

type Account = { id: string; name: string; status: string };

function ConversationsInner() {
  const params = useSearchParams();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [unread, setUnread] = useState(false);
  const selected = params.get("c");
  const accounts = useQuery({ queryKey: ["messaging-accounts"], queryFn: () => api<Account[]>("/messaging/accounts"), refetchInterval: 15_000 });
  const acc = accounts.data?.[0];
  return (
    <>
      <PageHeader
        title="Conversas"
        description="Histórico do WhatsApp vinculado aos leads. Envio sempre individual, com consentimento ou em resposta ao contato."
        actions={
          <>
            {acc ? (
              <StatusBadge tone={acc.status === "CONNECTED" ? "success" : "warning"} pulse={acc.status !== "CONNECTED"}>
                {acc.name}: {acc.status === "CONNECTED" ? "conectado" : acc.status === "QR_PENDING" ? "aguardando QR Code" : "desconectado"}
              </StatusBadge>
            ) : null}
            <Button variant="outline" size="sm" asChild>
              <Link href="/configuracoes?tab=whatsapp">
                <Settings /> WhatsApp
              </Link>
            </Button>
          </>
        }
      />
      {!accounts.isLoading && !acc ? (
        <EmptyState
          icon={MessageCircle}
          title="WhatsApp não configurado"
          description="Conecte uma conta de teste em Configurações → WhatsApp para registrar conversas."
          action={
            <Button asChild>
              <Link href="/configuracoes?tab=whatsapp">Configurar</Link>
            </Button>
          }
        />
      ) : (
        <div className="card-soft grid h-[calc(100dvh-14rem)] min-h-[480px] overflow-hidden md:grid-cols-[320px_1fr]">
          <aside className="flex min-h-0 flex-col border-r">
            <div className="grid gap-2 border-b p-3">
              <div className="relative">
                <SearchIcon className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input className="h-8 pl-8" placeholder="Buscar nome, número ou empresa" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar conversas" />
              </div>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <Switch checked={unread} onCheckedChange={setUnread} /> Só não lidas
              </label>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <ConversationList query={{ q: q || undefined, unread: unread || undefined }} selected={selected} onSelect={(id) => router.replace(`/conversas?c=${id}`)} />
            </div>
          </aside>
          <section className="min-h-0">
            {selected ? (
              <Thread conversationId={selected} />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Selecione uma conversa</div>
            )}
          </section>
        </div>
      )}
    </>
  );
}

export default function ConversationsPage() {
  return (
    <Suspense>
      <ConversationsInner />
    </Suspense>
  );
}
