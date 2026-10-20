"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Check, Loader2, LogOut, Plug, PlugZap, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Field } from "@/components/form-field";
import { SectionCard } from "@/components/page";
import { StatusBadge } from "@/components/status-badge";
import { ConsentDialog } from "@/components/messaging/consent-dialog";
import { api, errorMessage } from "@/lib/api";
import { fmtDateTime, fmtPhone, fmtRelative } from "@/lib/format";
import { useSession } from "@/lib/session";
import { useOrg } from "./organization";
import { useSyncedState } from "@/lib/hooks";

type Account = { id: string; name: string; provider: string; status: string; phoneJid: string | null; lastError: string | null; lastStatusAt: string | null };
const STATUS: Record<string, { label: string; tone: "success" | "warning" | "danger" | "neutral" | "info" }> = {
  CONNECTED: { label: "Conectado", tone: "success" },
  QR_PENDING: { label: "Aguardando leitura do QR Code", tone: "info" },
  CONNECTING: { label: "Conectando…", tone: "info" },
  DISCONNECTED: { label: "Desconectado", tone: "warning" },
  LOGGED_OUT: { label: "Sessão encerrada", tone: "neutral" },
  ERROR: { label: "Erro", tone: "danger" },
};

function AccountCard({ account }: { account: Account }) {
  const qc = useQueryClient();
  const { can } = useSession();
  const manage = can("messaging:manage");
  const live = useQuery({ queryKey: ["wa-status", account.id], queryFn: () => api<Account>(`/messaging/accounts/${account.id}/status`), refetchInterval: 8000, initialData: account });
  const reported = live.data?.status ?? account.status;
  const qr = useQuery({
    queryKey: ["wa-qr", account.id],
    queryFn: () => api<{ status: string; qr: string | null }>(`/messaging/accounts/${account.id}/qr`),
    enabled: manage && reported !== "CONNECTED",
    refetchInterval: 5000,
  });
  // com QR Code ativo na tela, a conta está aguardando leitura (mesmo que o status ainda não tenha sido atualizado)
  const qrImage = qr.isError ? null : (qr.data?.qr ?? null);
  const status = reported !== "CONNECTED" && qrImage ? "QR_PENDING" : reported;
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["messaging-accounts"] });
    qc.invalidateQueries({ queryKey: ["wa-status", account.id] });
    qc.invalidateQueries({ queryKey: ["wa-qr", account.id] });
  };
  const action = useMutation({
    mutationFn: (a: "connect" | "disconnect" | "logout" | "delete") =>
      a === "delete" ? api(`/messaging/accounts/${account.id}`, { method: "DELETE" }) : api(`/messaging/accounts/${account.id}/${a}`, { method: "POST" }),
    onSuccess: () => refresh(),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const st = STATUS[status] ?? STATUS.DISCONNECTED!;
  return (
    <SectionCard
      title={account.name}
      description={account.provider === "WUZAPI" ? "WuzAPI (local, não oficial)" : "WhatsApp Business Cloud API (oficial)"}
      actions={<StatusBadge tone={st.tone} pulse={status === "CONNECTING" || status === "QR_PENDING"}>{st.label}</StatusBadge>}
    >
      <div className="grid gap-4 md:grid-cols-[1fr_auto]">
        <div className="grid content-start gap-2 text-sm">
          {live.data?.phoneJid && <div>Número conectado: <b>{fmtPhone(`+${live.data.phoneJid.split(/[:@.]/)[0]}`)}</b></div>}
          {live.data?.lastError && status !== "CONNECTED" && <div className="text-xs text-muted-foreground">Último aviso: {live.data.lastError}</div>}
          {live.data?.lastStatusAt && <div className="text-xs text-muted-foreground">Estado atualizado {fmtRelative(live.data.lastStatusAt)}</div>}
          {status === "QR_PENDING" && (
            <ol className="mt-1 list-decimal space-y-1 pl-5 text-xs text-muted-foreground">
              <li>No celular de teste, abra o WhatsApp → Configurações → Aparelhos conectados.</li>
              <li>Toque em “Conectar um aparelho” e aponte para o QR Code ao lado.</li>
              <li>O código é renovado automaticamente a cada ~20 segundos.</li>
            </ol>
          )}
          {manage && (
            <div className="mt-2 flex flex-wrap gap-2">
              {status !== "CONNECTED" && (
                <Button size="sm" onClick={() => action.mutate("connect")} disabled={action.isPending}>
                  <PlugZap /> Reconectar
                </Button>
              )}
              {status === "CONNECTED" && (
                <Button size="sm" variant="outline" onClick={() => action.mutate("disconnect")} disabled={action.isPending}>
                  <Plug /> Desconectar
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => action.mutate("logout")} disabled={action.isPending}>
                <LogOut /> Encerrar sessão
              </Button>
              <Button size="sm" variant="ghost" onClick={() => confirm("Remover a conta e o histórico de conversas dela?") && action.mutate("delete")} disabled={action.isPending}>
                <Trash2 /> Remover
              </Button>
            </div>
          )}
        </div>
        {manage && status !== "CONNECTED" && (
          <div className="flex size-56 items-center justify-center rounded-xl border bg-white p-2">
            {qrImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qrImage} alt="QR Code para conectar o WhatsApp" className="size-full" />
            ) : (
              <span className="px-4 text-center text-xs text-muted-foreground">{qr.isFetching ? "Gerando QR Code…" : "Clique em Reconectar para gerar o QR Code"}</span>
            )}
          </div>
        )}
      </div>
    </SectionCard>
  );
}

function Rules() {
  const qc = useQueryClient();
  const org = useOrg();
  const { can } = useSession();
  const [draft, setDraft] = useSyncedState(org.data, (d): { maxOutboundPerHour: number; maxOutboundPerDay: number; requireApproval: boolean; optOutKeywords: string } | null =>
    d ? { ...d.settings.messaging, optOutKeywords: d.settings.messaging.optOutKeywords.join(", ") } : null,
  );
  const save = useMutation({
    mutationFn: () => api("/org", { method: "PATCH", body: { settings: { messaging: { ...draft!, optOutKeywords: draft!.optOutKeywords.split(",").map((s) => s.trim()).filter(Boolean) } } } }),
    onSuccess: () => {
      toast.success("Regras salvas");
      qc.invalidateQueries({ queryKey: ["org"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (!draft) return null;
  const editable = can("settings:manage");
  return (
    <SectionCard title="Regras de envio" description="Valem para mensagens iniciadas pela empresa. Respostas a quem escreveu nas últimas 24 h não precisam de aprovação.">
      <div className="grid gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Field id="wa-h" label="Máximo por hora">
            <Input id="wa-h" type="number" min={1} value={draft.maxOutboundPerHour} disabled={!editable} onChange={(e) => setDraft({ ...draft, maxOutboundPerHour: Number(e.target.value) })} />
          </Field>
          <Field id="wa-d" label="Máximo por dia">
            <Input id="wa-d" type="number" min={1} value={draft.maxOutboundPerDay} disabled={!editable} onChange={(e) => setDraft({ ...draft, maxOutboundPerDay: Number(e.target.value) })} />
          </Field>
        </div>
        <label className="flex items-center justify-between gap-4">
          <span className="text-[13px]">Exigir aprovação de gestor para mensagens iniciadas pela empresa</span>
          <Switch checked={draft.requireApproval} disabled={!editable} onCheckedChange={(v) => setDraft({ ...draft, requireApproval: v })} />
        </label>
        <Field id="wa-kw" label="Palavras de opt-out" hint="Mensagens recebidas com estas palavras bloqueiam o número automaticamente.">
          <Textarea id="wa-kw" rows={2} value={draft.optOutKeywords} disabled={!editable} onChange={(e) => setDraft({ ...draft, optOutKeywords: e.target.value })} />
        </Field>
        {editable && (
          <Button className="justify-self-end" onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending && <Loader2 className="animate-spin" />} Salvar regras
          </Button>
        )}
      </div>
    </SectionCard>
  );
}

function Approvals() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["pending-messages"], queryFn: () => api<{ id: string; body: string; createdAt: string; sentBy: { name: string } | null; conversation: { id: string; contactPhone: string; contactName: string | null; company: { id: string; name: string } | null } }[]>("/messages/pending"), refetchInterval: 15_000 });
  const decide = useMutation({
    mutationFn: ({ id, approve }: { id: string; approve: boolean }) => api(`/messages/${id}/approve`, { method: "POST", body: { approve } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pending-messages"] }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <SectionCard title="Aprovações pendentes" description="Mensagens iniciadas pela empresa aguardando revisão." bodyClassName="p-0">
      {!q.data?.length ? (
        <p className="px-5 py-6 text-sm text-muted-foreground">Nada aguardando aprovação.</p>
      ) : (
        <ul className="divide-y">
          {q.data.map((m) => (
            <li key={m.id} className="grid gap-2 px-5 py-3">
              <div className="text-xs text-muted-foreground">
                {m.sentBy?.name} → <Link className="text-primary hover:underline" href={`/conversas?c=${m.conversation.id}`}>{m.conversation.contactName ?? fmtPhone(m.conversation.contactPhone)}</Link>
                {m.conversation.company && ` (${m.conversation.company.name})`} · {fmtDateTime(m.createdAt)}
              </div>
              <p className="text-sm whitespace-pre-wrap">{m.body}</p>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => decide.mutate({ id: m.id, approve: true })}>
                  <Check /> Aprovar e enviar
                </Button>
                <Button size="sm" variant="ghost" onClick={() => decide.mutate({ id: m.id, approve: false })}>
                  <X /> Rejeitar
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

function Templates() {
  const qc = useQueryClient();
  const { can } = useSession();
  const q = useQuery({ queryKey: ["templates"], queryFn: () => api<{ id: string; name: string; body: string; category: string; isActive: boolean }[]>("/message-templates") });
  const [form, setForm] = useState({ name: "", body: "" });
  const create = useMutation({
    mutationFn: () => api("/message-templates", { method: "POST", body: form }),
    onSuccess: () => {
      setForm({ name: "", body: "" });
      qc.invalidateQueries({ queryKey: ["templates"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const toggle = useMutation({ mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => api(`/message-templates/${id}`, { method: "PATCH", body: { isActive } }), onSuccess: () => qc.invalidateQueries({ queryKey: ["templates"] }) });
  const remove = useMutation({ mutationFn: (id: string) => api(`/message-templates/${id}`, { method: "DELETE" }), onSuccess: () => qc.invalidateQueries({ queryKey: ["templates"] }) });
  const manage = can("messaging:manage");
  return (
    <SectionCard title="Modelos de mensagem" description="Variáveis: {{contato}}, {{empresa}}, {{usuario}}, {{organizacao}}." bodyClassName="p-0">
      <ul className="divide-y">
        {q.data?.map((t) => (
          <li key={t.id} className="flex items-start gap-3 px-5 py-3">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{t.name}</div>
              <p className="mt-0.5 text-xs whitespace-pre-wrap text-muted-foreground">{t.body}</p>
            </div>
            {manage && (
              <>
                <Switch checked={t.isActive} onCheckedChange={(isActive) => toggle.mutate({ id: t.id, isActive })} aria-label={`Ativar ${t.name}`} />
                <Button variant="ghost" size="icon-sm" onClick={() => remove.mutate(t.id)} aria-label={`Excluir ${t.name}`}>
                  <Trash2 />
                </Button>
              </>
            )}
          </li>
        ))}
      </ul>
      {manage && (
        <div className="grid gap-2 border-t px-5 py-4">
          <Input placeholder="Nome do modelo" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} aria-label="Nome do modelo" />
          <Textarea rows={2} placeholder="Olá, {{contato}}! …" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} aria-label="Texto do modelo" />
          <Button size="sm" className="justify-self-end" onClick={() => create.mutate()} disabled={form.name.length < 2 || !form.body.trim()}>
            <Plus /> Adicionar modelo
          </Button>
        </div>
      )}
    </SectionCard>
  );
}

function SuppressionAndConsents() {
  const qc = useQueryClient();
  const { can } = useSession();
  const [phone, setPhone] = useState("");
  const sup = useQuery({ queryKey: ["suppression"], queryFn: () => api<{ id: string; value: string; reason: string; source: string | null; createdAt: string }[]>("/suppression") });
  const consents = useQuery({ queryKey: ["consents"], queryFn: () => api<{ id: string; contactValue: string; status: string; legalBasis: string; source: string; evidence: string | null; createdAt: string; recordedBy: { name: string } | null; company: { id: string; name: string } | null }[]>("/consents") });
  const add = useMutation({
    mutationFn: () => api("/suppression", { method: "POST", body: { value: phone, reason: "MANUAL", source: "Inclusão manual" } }),
    onSuccess: () => {
      setPhone("");
      qc.invalidateQueries({ queryKey: ["suppression"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => {
      const justification = prompt("Justificativa para retirar da lista de bloqueio (mínimo 10 caracteres):") ?? "";
      return api(`/suppression/${id}`, { method: "DELETE", body: { justification } });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["suppression"] }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <SectionCard title="Lista de bloqueio (opt-out)" description="Números que não podem receber mensagens." bodyClassName="p-0">
        {can("consent:manage") && (
          <form className="flex gap-2 border-b px-5 py-3" onSubmit={(e) => (e.preventDefault(), add.mutate())}>
            <Input className="h-8" placeholder="(19) 99999-0000" value={phone} onChange={(e) => setPhone(e.target.value)} aria-label="Número a bloquear" />
            <Button size="sm" type="submit" disabled={phone.length < 8}>
              Bloquear
            </Button>
          </form>
        )}
        <ul className="max-h-80 divide-y overflow-y-auto">
          {sup.data?.map((s) => (
            <li key={s.id} className="flex items-center gap-2 px-5 py-2 text-sm">
              <span className="font-medium">{fmtPhone(s.value)}</span>
              <span className="truncate text-xs text-muted-foreground">
                {s.reason === "OPT_OUT" ? "pediu para sair" : "manual"} · {fmtDateTime(s.createdAt)}
              </span>
              {can("privacy:manage") && (
                <Button variant="ghost" size="icon-xs" className="ml-auto" onClick={() => remove.mutate(s.id)} aria-label="Retirar da lista">
                  <X />
                </Button>
              )}
            </li>
          ))}
          {!sup.data?.length && <li className="px-5 py-4 text-sm text-muted-foreground">Lista vazia.</li>}
        </ul>
      </SectionCard>
      <SectionCard title="Autorizações registradas" description="Histórico de consentimentos (concessões e revogações)." actions={can("consent:manage") && <ConsentDialog trigger={<Button size="sm" variant="outline"><Plus /> Registrar</Button>} />} bodyClassName="p-0">
        <ul className="max-h-80 divide-y overflow-y-auto">
          {consents.data?.map((c) => (
            <li key={c.id} className="grid gap-0.5 px-5 py-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="font-medium">{fmtPhone(c.contactValue)}</span>
                <StatusBadge tone={c.status === "GRANTED" ? "success" : "danger"}>{c.status === "GRANTED" ? "autorizado" : "revogado"}</StatusBadge>
                {c.company && <span className="truncate text-xs text-muted-foreground">{c.company.name}</span>}
              </div>
              <span className="text-xs text-muted-foreground">
                {c.source} · {fmtDateTime(c.createdAt)} {c.recordedBy && `· por ${c.recordedBy.name}`}
              </span>
            </li>
          ))}
          {!consents.data?.length && <li className="px-5 py-4 text-sm text-muted-foreground">Nenhuma autorização registrada.</li>}
        </ul>
      </SectionCard>
    </div>
  );
}

export function WhatsappSettings() {
  const qc = useQueryClient();
  const { can } = useSession();
  const [name, setName] = useState("WhatsApp de teste");
  const accounts = useQuery({ queryKey: ["messaging-accounts"], queryFn: () => api<Account[]>("/messaging/accounts") });
  const create = useMutation({
    mutationFn: () => api("/messaging/accounts", { method: "POST", body: { name } }),
    onSuccess: () => {
      toast.success("Instância criada", { description: "Escaneie o QR Code com o celular de teste." });
      qc.invalidateQueries({ queryKey: ["messaging-accounts"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div className="grid gap-6">
      <Alert className="border-warning/40 bg-warning-soft/50">
        <AlertTriangle className="text-warning" />
        <AlertTitle>Use apenas números de teste autorizados</AlertTitle>
        <AlertDescription className="text-[13px]">
          O WuzAPI usa uma integração não oficial do WhatsApp; uso fora dos Termos pode bloquear o número. Não há disparo em massa: cada envio é individual, exige consentimento registrado ou resposta a quem escreveu, respeita
          opt-out e limites, e pode exigir aprovação. Para uso comercial em escala, migre para a API oficial (adaptador já preparado).
        </AlertDescription>
      </Alert>
      {accounts.data?.map((a) => <AccountCard key={a.id} account={a} />)}
      {can("messaging:manage") && !accounts.data?.length && (
        <SectionCard title="Conectar WhatsApp" description="Cria uma instância isolada no WuzAPI com webhook assinado (HMAC) e gera o QR Code.">
          <div className="flex flex-wrap items-end gap-2">
            <Field id="wa-name" label="Nome da conta" className="min-w-64 flex-1">
              <Input id="wa-name" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Button onClick={() => create.mutate()} disabled={create.isPending || name.length < 2}>
              {create.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />} Criar e conectar
            </Button>
          </div>
        </SectionCard>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <Rules />
        {can("messages:approve") && <Approvals />}
      </div>
      <Templates />
      <SuppressionAndConsents />
    </div>
  );
}
