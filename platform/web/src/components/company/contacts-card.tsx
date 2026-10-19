"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, Mail, MessageCircle, Phone, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SectionCard } from "@/components/page";
import { StatusBadge, dataTone } from "@/components/status-badge";
import { api, errorMessage } from "@/lib/api";
import { DATA_STATUS_LABEL, SOURCE_LABEL } from "@/lib/labels";
import { fmtPhone, fmtRelative } from "@/lib/format";
import type { Contact } from "./types";

const ICONS = { EMAIL: Mail, PHONE: Phone, WHATSAPP: MessageCircle } as const;

function verificationNote(c: Contact) {
  const v = (c.verification ?? {}) as Record<string, unknown>;
  const parts: string[] = [];
  if (c.type === "EMAIL") {
    if (v.mx === true) parts.push("MX ok (não garante entrega)");
    if (v.mx === false) parts.push("sem MX: o domínio não recebe e-mails");
    if (v.mx == null && "mx" in v) parts.push("MX não verificado");
    if (v.sameDomainAsWebsite) parts.push("mesmo domínio do site oficial");
  } else {
    if (v.e164Valid === false) parts.push("número inválido");
    if (v.numberType) parts.push(String(v.numberType) === "MOBILE" ? "celular" : String(v.numberType) === "FIXED_LINE" ? "fixo" : String(v.numberType).toLowerCase());
    if (v.crossSource) parts.push(`confirmado também em ${SOURCE_LABEL[String(v.crossSource)] ?? v.crossSource}`);
    if (v.evidence) parts.push(String(v.evidence));
  }
  return parts.join(" · ");
}

export function ContactsCard({ companyId, contacts, canEdit }: { companyId: string; contacts: Contact[]; canEdit: boolean }) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [type, setType] = useState<"PHONE" | "EMAIL" | "WHATSAPP">("PHONE");
  const [value, setValue] = useState("");
  const refresh = () => qc.invalidateQueries({ queryKey: ["company", companyId] });

  const add = useMutation({
    mutationFn: () => api(`/companies/${companyId}/contacts`, { method: "POST", body: { type, value } }),
    onSuccess: () => {
      toast.success("Contato adicionado");
      setValue("");
      setAdding(false);
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/companies/${companyId}/contacts/${id}`, { method: "DELETE" }),
    onSuccess: () => refresh(),
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <SectionCard
      title="Contatos"
      description="Telefones normalizados em E.164 e e-mails com verificação de domínio."
      actions={
        canEdit && (
          <Button variant="ghost" size="sm" onClick={() => setAdding((a) => !a)}>
            <Plus /> Adicionar
          </Button>
        )
      }
      bodyClassName="p-0"
    >
      {adding && (
        <form
          className="flex flex-wrap items-center gap-2 border-b px-5 py-3"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
        >
          <Select value={type} onValueChange={(v) => setType(v as typeof type)}>
            <SelectTrigger className="h-8 w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="PHONE">Telefone</SelectItem>
              <SelectItem value="WHATSAPP">WhatsApp</SelectItem>
              <SelectItem value="EMAIL">E-mail</SelectItem>
            </SelectContent>
          </Select>
          <Input autoFocus className="h-8 min-w-48 flex-1" value={value} onChange={(e) => setValue(e.target.value)} placeholder={type === "EMAIL" ? "contato@empresa.com.br" : "(19) 99999-0000"} />
          <Button size="sm" type="submit" disabled={add.isPending || value.length < 3}>
            Salvar
          </Button>
        </form>
      )}
      {contacts.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted-foreground">Nenhum contato encontrado até agora. Enriquecer o site oficial pode revelar e-mails e telefones públicos.</p>
      ) : (
        <ul className="divide-y">
          {contacts.map((c) => {
            const Icon = ICONS[c.type];
            const display = c.type === "EMAIL" ? c.normalizedValue : fmtPhone(c.normalizedValue);
            return (
              <li key={c.id} className="group flex items-start gap-3 px-5 py-3">
                <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                  <Icon className="size-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`text-sm font-medium ${c.status === "INVALID" ? "text-muted-foreground line-through" : ""}`}>{display}</span>
                    <StatusBadge tone={dataTone(c.status)}>{DATA_STATUS_LABEL[c.status]}</StatusBadge>
                    {c.type === "WHATSAPP" && <span className="text-[11px] text-muted-foreground">WhatsApp divulgado</span>}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {SOURCE_LABEL[c.source] ?? c.source} · {fmtRelative(c.collectedAt)} · confiança {Math.round(c.confidence * 100)}%
                    {verificationNote(c) && <> · {verificationNote(c)}</>}
                  </div>
                </div>
                <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Copiar"
                    onClick={() => {
                      navigator.clipboard.writeText(c.normalizedValue);
                      toast.success("Copiado");
                    }}
                  >
                    <Copy />
                  </Button>
                  {canEdit && (
                    <Button variant="ghost" size="icon-sm" aria-label="Remover contato" onClick={() => remove.mutate(c.id)}>
                      <Trash2 />
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}
