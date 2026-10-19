"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, MessageCirclePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/page";
import { api, errorMessage } from "@/lib/api";
import { fmtPhone } from "@/lib/format";
import { useSession } from "@/lib/session";
import { ConversationList } from "./conversation-list";
import { Thread } from "./thread";

type Account = { id: string; name: string; status: string };
type Contact = { type: string; normalizedValue: string; status: string };

export function CompanyConversations({ companyId }: { companyId: string }) {
  const qc = useQueryClient();
  const { can } = useSession();
  const [selected, setSelected] = useState<string | null>(null);
  const accounts = useQuery({ queryKey: ["messaging-accounts"], queryFn: () => api<Account[]>("/messaging/accounts") });
  const company = useQuery({ queryKey: ["company", companyId], queryFn: () => api<{ contacts: Contact[] }>(`/companies/${companyId}`) });
  const phones = [...new Set((company.data?.contacts ?? []).filter((c) => c.type !== "EMAIL" && c.status !== "INVALID").map((c) => c.normalizedValue))];
  const [phone, setPhone] = useState<string>("");
  const open = useMutation({
    mutationFn: () => api<{ id: string }>("/conversations", { method: "POST", body: { accountId: accounts.data![0]!.id, phone: phone || phones[0], companyId } }),
    onSuccess: (r) => {
      setSelected(r.id);
      qc.invalidateQueries({ queryKey: ["conversations"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (accounts.data && !accounts.data.length) return <EmptyState title="WhatsApp não configurado" description="Configure uma conta em Configurações → WhatsApp." />;

  return (
    <div className="grid gap-4">
      {can("messages:send") && phones.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <Select value={phone || phones[0]} onValueChange={setPhone}>
            <SelectTrigger className="h-8 w-56" aria-label="Número do lead">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {phones.map((p) => (
                <SelectItem key={p} value={p}>
                  {fmtPhone(p)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" onClick={() => open.mutate()} disabled={open.isPending || !accounts.data?.length}>
            {open.isPending ? <Loader2 className="animate-spin" /> : <MessageCirclePlus />} Abrir conversa
          </Button>
          <span className="text-xs text-muted-foreground">O envio exige autorização registrada ou mensagem recebida nas últimas 24 h.</span>
        </div>
      )}
      <div className="card-soft grid min-h-[420px] overflow-hidden md:grid-cols-[260px_1fr]">
        <div className="border-r">
          <ConversationList query={{ companyId }} selected={selected} onSelect={setSelected} />
        </div>
        <div className="h-[520px] min-h-0">{selected ? <Thread conversationId={selected} /> : <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Selecione ou abra uma conversa</div>}</div>
      </div>
    </div>
  );
}
