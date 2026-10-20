"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, Loader2, Search, ShieldCheck, Trash2, UserX, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { SectionCard } from "@/components/page";
import { StatusBadge } from "@/components/status-badge";
import { Field } from "@/components/form-field";
import { api, downloadFile, errorMessage } from "@/lib/api";
import { fmtDate, fmtDateTime, fmtNumber, fmtPhone } from "@/lib/format";
import { SOURCE_LABEL } from "@/lib/labels";

type Overview = {
  retention: { rawDataDays: number; archivedCompanyDays: number; auditLogDays: number; webhookEventDays: number };
  counts: { contacts: Record<string, number>; conversations: number; messages: number; consents: number; suppression: Record<string, number>; webhookEvents: number; erasures: number };
  lastRetentionAt: string | null;
};

type SubjectResult = {
  subject: { kind: "EMAIL" | "PHONE"; value: string };
  contacts: { id: string; type: string; value: string; status: string; source: string; sourceUrl: string | null; collectedAt: string; company: { id: string; name: string; city: string | null } }[];
  primaryOf: { id: string; name: string }[];
  conversations: { id: string; contactName: string | null; messages: number; lastMessageAt: string | null; company: { id: string; name: string } | null }[];
  consents: { id: string; status: string; legalBasis: string; source: string; createdAt: string }[];
  suppression: { id: string; channel: string; reason: string; createdAt: string }[];
  mentions: { activities: number; notes: number };
};

type Suppressed = { id: string; value: string; channel: string; reason: string; source: string | null; createdAt: string };

const show = (s: { kind: string; value: string }) => (s.kind === "PHONE" ? fmtPhone(s.value) : s.value);

export function PrivacySettings() {
  return (
    <div className="grid gap-6">
      <SubjectRequest />
      <div className="grid gap-6 lg:grid-cols-2">
        <InventoryCard />
        <CollectionBlocklist />
      </div>
    </div>
  );
}

function SubjectRequest() {
  const [value, setValue] = useState("");
  const [query, setQuery] = useState<string | null>(null);
  const result = useQuery({ queryKey: ["privacy-subject", query], queryFn: () => api<SubjectResult>("/privacy/subject", { query: { value: query } }), enabled: !!query, retry: false });
  const [exporting, setExporting] = useState(false);
  const d = result.data;
  const total = d ? d.contacts.length + d.conversations.length + d.consents.length + d.mentions.activities + d.mentions.notes + d.primaryOf.length : 0;

  return (
    <SectionCard
      title="Solicitação do titular"
      description="Localize, exporte ou exclua os dados de uma pessoa a partir do e-mail ou telefone (LGPD, art. 18). Cada consulta fica registrada na trilha de auditoria apenas com o hash do identificador."
    >
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim().length >= 5) setQuery(value.trim());
        }}
      >
        <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder="E-mail ou telefone com DDD" aria-label="E-mail ou telefone do titular" className="sm:max-w-sm" />
        <Button type="submit" disabled={value.trim().length < 5 || result.isFetching}>
          {result.isFetching ? <Loader2 className="animate-spin" /> : <Search />} Localizar dados
        </Button>
      </form>

      {result.isError && <p className="mt-4 text-sm text-destructive">{errorMessage(result.error)}</p>}
      {d && (
        <div className="mt-5 grid gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/40 px-4 py-3">
            <div>
              <div className="text-sm font-medium">{show(d.subject)}</div>
              <div className="text-xs text-muted-foreground">{total ? `${fmtNumber(total)} registro(s) encontrados` : "Nenhum dado associado a este identificador"}</div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={exporting}
                onClick={async () => {
                  setExporting(true);
                  try {
                    await downloadFile("/privacy/subject/export", { value: d.subject.value });
                    toast.success("Exportação gerada");
                  } catch (e) {
                    toast.error(errorMessage(e));
                  } finally {
                    setExporting(false);
                  }
                }}
              >
                {exporting ? <Loader2 className="animate-spin" /> : <Download />} Exportar (JSON)
              </Button>
              <EraseDialog subject={d.subject} onDone={() => result.refetch()} />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Group title="Contatos em cadastros" empty="Nenhum contato com este valor.">
              {d.contacts.map((c) => (
                <li key={c.id} className="flex items-start justify-between gap-3 py-2 text-sm">
                  <div className="min-w-0">
                    <Link href={`/empresas/${c.company.id}`} className="truncate font-medium hover:text-primary">
                      {c.company.name}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      {c.type === "EMAIL" ? "E-mail" : c.type === "WHATSAPP" ? "WhatsApp" : "Telefone"} · {SOURCE_LABEL[c.source] ?? c.source} · coletado em {fmtDate(c.collectedAt)}
                    </div>
                  </div>
                </li>
              ))}
            </Group>
            <Group title="Conversas de WhatsApp" empty="Nenhuma conversa.">
              {d.conversations.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="truncate">{c.contactName ?? c.company?.name ?? "Sem nome"}</span>
                  <span className="text-xs text-muted-foreground">
                    {c.messages} mensagem(ns) · {fmtDate(c.lastMessageAt)}
                  </span>
                </li>
              ))}
            </Group>
            <Group title="Autorizações de contato" empty="Nenhuma autorização registrada.">
              {d.consents.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="truncate">{c.source}</span>
                  <StatusBadge tone={c.status === "GRANTED" ? "success" : "danger"}>{c.status === "GRANTED" ? "autorizado" : "revogado"}</StatusBadge>
                </li>
              ))}
            </Group>
            <Group title="Outros registros" empty="">
              <li className="flex justify-between py-2 text-sm">
                <span>Menções em atividades</span>
                <span className="num">{d.mentions.activities}</span>
              </li>
              <li className="flex justify-between py-2 text-sm">
                <span>Menções em anotações</span>
                <span className="num">{d.mentions.notes}</span>
              </li>
              <li className="flex justify-between py-2 text-sm">
                <span>Contato principal de empresa</span>
                <span className="num">{d.primaryOf.length}</span>
              </li>
              <li className="flex justify-between py-2 text-sm">
                <span>Lista de bloqueio</span>
                <span>{d.suppression.length ? d.suppression.map((s) => (s.channel === "COLLECTION" ? "coleta" : "WhatsApp")).join(", ") : "não"}</span>
              </li>
            </Group>
          </div>
        </div>
      )}
    </SectionCard>
  );
}

function Group({ title, empty, children }: { title: string; empty: string; children: React.ReactNode }) {
  const has = Array.isArray(children) ? children.length > 0 : !!children;
  return (
    <div className="rounded-lg border px-4 py-3">
      <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</h3>
      {has ? <ul className="divide-y">{children}</ul> : <p className="py-2 text-sm text-muted-foreground">{empty}</p>}
    </div>
  );
}

function EraseDialog({ subject, onDone }: { subject: SubjectResult["subject"]; onDone: () => void }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("SUBJECT_REQUEST");
  const [notes, setNotes] = useState("");
  const [suppress, setSuppress] = useState(true);
  const [confirm, setConfirm] = useState("");
  const erase = useMutation({
    mutationFn: () =>
      api<{ contacts: number; conversations: number; consents: number; redacted: number; rawCleared: number }>("/privacy/subject/erase", {
        method: "POST",
        body: { value: subject.value, reason, notes: notes || undefined, suppress },
      }),
    onSuccess: (r) => {
      toast.success("Dados excluídos", { description: `${r.contacts} contato(s), ${r.conversations} conversa(s), ${r.consents} autorização(ões); ${r.redacted} texto(s) anonimizados.` });
      setOpen(false);
      setConfirm("");
      qc.invalidateQueries({ queryKey: ["privacy-overview"] });
      qc.invalidateQueries({ queryKey: ["suppression"] });
      onDone();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="destructive" size="sm">
          <UserX /> Excluir dados
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Excluir dados de {show(subject)}</DialogTitle>
          <DialogDescription>
            Remove o contato de todas as empresas, as conversas e mensagens, as autorizações e os dados brutos de coleta que o contenham; menções em atividades e anotações são substituídas por “[removido]”. A ação não pode ser desfeita.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Field id="er-reason" label="Motivo">
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger id="er-reason" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="SUBJECT_REQUEST">Pedido do titular</SelectItem>
                <SelectItem value="INCORRECT_DATA">Dado incorreto ou de terceiro</SelectItem>
                <SelectItem value="OTHER">Outro</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field id="er-notes" label="Observações (opcional)" hint="Ex.: protocolo do pedido. Não inclua o próprio dado pessoal.">
            <Textarea id="er-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <Label className="flex items-start gap-2 text-sm font-normal">
            <Checkbox checked={suppress} onCheckedChange={(v) => setSuppress(v === true)} className="mt-0.5" />
            <span>
              Manter na lista de bloqueio para não coletar nem contatar de novo <span className="text-muted-foreground">(recomendado; guarda apenas o identificador)</span>
            </span>
          </Label>
          <Field id="er-confirm" label='Digite "EXCLUIR" para confirmar'>
            <Input id="er-confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="destructive" onClick={() => erase.mutate()} disabled={confirm !== "EXCLUIR" || erase.isPending}>
            {erase.isPending ? <Loader2 className="animate-spin" /> : <Trash2 />} Excluir definitivamente
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InventoryCard() {
  const q = useQuery({ queryKey: ["privacy-overview"], queryFn: () => api<Overview>("/privacy/overview") });
  const o = q.data;
  return (
    <SectionCard
      title="Inventário e retenção"
      description="Dados pessoais guardados e prazos aplicados automaticamente todos os dias às 03:00."
      actions={
        <Button variant="ghost" size="sm" asChild>
          <Link href="/configuracoes?tab=organizacao">Ajustar prazos</Link>
        </Button>
      }
    >
      {!o ? (
        <div className="grid gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-6" />
          ))}
        </div>
      ) : (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Telefones</dt>
          <dd className="num text-right">{fmtNumber(o.counts.contacts.PHONE ?? 0)}</dd>
          <dt className="text-muted-foreground">WhatsApp</dt>
          <dd className="num text-right">{fmtNumber(o.counts.contacts.WHATSAPP ?? 0)}</dd>
          <dt className="text-muted-foreground">E-mails</dt>
          <dd className="num text-right">{fmtNumber(o.counts.contacts.EMAIL ?? 0)}</dd>
          <dt className="text-muted-foreground">Conversas / mensagens</dt>
          <dd className="num text-right">
            {fmtNumber(o.counts.conversations)} / {fmtNumber(o.counts.messages)}
          </dd>
          <dt className="text-muted-foreground">Autorizações registradas</dt>
          <dd className="num text-right">{fmtNumber(o.counts.consents)}</dd>
          <dt className="text-muted-foreground">Bloqueio (WhatsApp / coleta)</dt>
          <dd className="num text-right">
            {fmtNumber(o.counts.suppression.WHATSAPP ?? 0)} / {fmtNumber(o.counts.suppression.COLLECTION ?? 0)}
          </dd>
          <dt className="text-muted-foreground">Exclusões atendidas</dt>
          <dd className="num text-right">{fmtNumber(o.counts.erasures)}</dd>
          <dt className="col-span-2 mt-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Prazos</dt>
          <dt className="text-muted-foreground">Dados brutos de coleta</dt>
          <dd className="text-right">{o.retention.rawDataDays} dias</dd>
          <dt className="text-muted-foreground">Empresas arquivadas</dt>
          <dd className="text-right">{o.retention.archivedCompanyDays} dias</dd>
          <dt className="text-muted-foreground">Trilha de auditoria</dt>
          <dd className="text-right">{o.retention.auditLogDays} dias</dd>
          <dt className="text-muted-foreground">Eventos de webhook</dt>
          <dd className="text-right">{o.retention.webhookEventDays} dias</dd>
          <dt className="text-muted-foreground">Última limpeza</dt>
          <dd className="text-right">{o.lastRetentionAt ? fmtDateTime(o.lastRetentionAt) : "sem exclusões até agora"}</dd>
        </dl>
      )}
      <p className="mt-4 flex gap-2 text-xs text-muted-foreground">
        <ShieldCheck className="size-4 shrink-0 text-primary" /> Base de dados de empresas (B2B) coletada de fontes públicas com origem registrada. Mensagens só com autorização ou em resposta ao contato.
      </p>
    </SectionCard>
  );
}

function CollectionBlocklist() {
  const q = useQuery({ queryKey: ["suppression", "COLLECTION"], queryFn: () => api<Suppressed[]>("/suppression", { query: { channel: "COLLECTION" } }) });
  return (
    <SectionCard title="Bloqueio de coleta" description="E-mails e telefones excluídos que não voltam a ser coletados por buscas, enriquecimento ou cadastro manual." bodyClassName="p-0">
      <ul className="max-h-96 divide-y overflow-y-auto">
        {q.data?.map((s) => (
          <li key={s.id} className="flex items-center gap-2 px-5 py-2 text-sm">
            <div className="min-w-0">
              <div className="truncate font-medium">{s.value.includes("@") ? s.value : fmtPhone(s.value)}</div>
              <div className="text-xs text-muted-foreground">
                {s.reason === "ERASURE" ? "excluído a pedido do titular" : s.reason.toLowerCase()} · {fmtDateTime(s.createdAt)}
              </div>
            </div>
            <RemoveSuppression id={s.id} />
          </li>
        ))}
        {q.data && !q.data.length && <li className="px-5 py-4 text-sm text-muted-foreground">Nenhum identificador bloqueado.</li>}
        {!q.data && (
          <li className="p-5">
            <Skeleton className="h-6" />
          </li>
        )}
      </ul>
    </SectionCard>
  );
}

/** Retirada da lista de bloqueio: exige justificativa e fica na trilha de auditoria. */
export function RemoveSuppression({ id }: { id: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [justification, setJustification] = useState("");
  const remove = useMutation({
    mutationFn: () => api(`/suppression/${id}`, { method: "DELETE", body: { justification } }),
    onSuccess: () => {
      setOpen(false);
      setJustification("");
      qc.invalidateQueries({ queryKey: ["suppression"] });
      qc.invalidateQueries({ queryKey: ["privacy-overview"] });
      toast.success("Retirado da lista de bloqueio");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon-xs" className="ml-auto" aria-label="Retirar da lista de bloqueio">
          <X />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Retirar da lista de bloqueio</DialogTitle>
          <DialogDescription>Faça isso apenas com nova autorização do titular. A justificativa fica registrada na trilha de auditoria.</DialogDescription>
        </DialogHeader>
        <Field id={`rs-${id}`} label="Justificativa" hint="Mínimo de 10 caracteres.">
          <Textarea id={`rs-${id}`} rows={3} value={justification} onChange={(e) => setJustification(e.target.value)} />
        </Field>
        <DialogFooter>
          <Button onClick={() => remove.mutate()} disabled={justification.trim().length < 10 || remove.isPending}>
            {remove.isPending && <Loader2 className="animate-spin" />} Retirar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
