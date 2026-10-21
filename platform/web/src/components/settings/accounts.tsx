"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Building2, Link2, Loader2, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field } from "@/components/form-field";
import { SectionCard } from "@/components/page";
import { api, errorMessage } from "@/lib/api";
import { fmtDate, fmtNumber, fmtRelative } from "@/lib/format";
import { InviteLink } from "./invite-link";

type Account = {
  id: string;
  name: string;
  createdAt: string;
  isMine: boolean;
  owner: { name: string; email: string; lastLoginAt: string | null; isActive: boolean } | null;
  pendingInvite: boolean;
  users: number;
  companies: number;
  searches: number;
};
type Created = { organizationName: string; name: string; email: string; emailSent: boolean; inviteLink: string };

const EMPTY = { organizationName: "", name: "", email: "" };

/** Contas de clientes: cada uma é uma empresa separada. Visível só para o administrador da plataforma. */
export function AccountsSettings() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [created, setCreated] = useState<Created | null>(null);
  const [relinked, setRelinked] = useState<{ name: string; link: string } | null>(null);
  const accounts = useQuery({ queryKey: ["platform-accounts"], queryFn: () => api<Account[]>("/platform/accounts") });

  const create = useMutation({
    mutationFn: () => api<{ emailSent: boolean; inviteLink: string }>("/platform/accounts", { method: "POST", body: form }),
    onSuccess: (r) => {
      setCreated({ ...form, ...r });
      qc.invalidateQueries({ queryKey: ["platform-accounts"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const relink = useMutation({
    mutationFn: (a: Account) => api<{ inviteLink: string }>(`/platform/accounts/${a.id}/invite-link`, { method: "POST" }).then((r) => ({ name: a.owner?.name ?? a.name, link: r.inviteLink })),
    onSuccess: (r) => setRelinked(r),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const toggleDialog = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setCreated(null);
      setForm(EMPTY);
    }
  };
  const valid = form.organizationName.trim().length >= 2 && form.name.trim().length >= 2 && form.email.includes("@");

  return (
    <SectionCard
      title="Contas de clientes"
      description="Cada conta é uma empresa separada: buscas, empresas, CRM e WhatsApp de uma conta nunca aparecem em outra. Aqui você vê só o nome, o responsável e os totais."
      bodyClassName="p-0"
      actions={
        <Dialog open={open} onOpenChange={toggleDialog}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus /> Nova conta
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            {created ? (
              <>
                <DialogHeader>
                  <DialogTitle>Conta criada</DialogTitle>
                  <DialogDescription>
                    {created.organizationName} já existe, vazia e separada das outras contas. {created.emailSent ? `O link também foi enviado para ${created.email}.` : `Não foi possível enviar o e-mail para ${created.email}.`} Se o e-mail não chegar, copie o link e envie para {created.name}, pelo WhatsApp, por exemplo.
                  </DialogDescription>
                </DialogHeader>
                <InviteLink key={created.inviteLink} link={created.inviteLink} />
                <DialogFooter>
                  <Button onClick={() => toggleDialog(false)}>Concluir</Button>
                </DialogFooter>
              </>
            ) : (
              <>
                <DialogHeader>
                  <DialogTitle>Nova conta</DialogTitle>
                  <DialogDescription>Cria uma empresa nova, com dados próprios. O responsável vira Proprietário dela e recebe um link para definir a senha.</DialogDescription>
                </DialogHeader>
                <div className="grid gap-3">
                  <Field id="na-org" label="Nome da empresa">
                    <Input id="na-org" value={form.organizationName} onChange={(e) => setForm({ ...form, organizationName: e.target.value })} />
                  </Field>
                  <Field id="na-name" label="Nome do responsável">
                    <Input id="na-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                  </Field>
                  <Field id="na-email" label="E-mail do responsável">
                    <Input id="na-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                  </Field>
                </div>
                <DialogFooter>
                  <Button onClick={() => create.mutate()} disabled={create.isPending || !valid}>
                    {create.isPending && <Loader2 className="animate-spin" />} Criar conta
                  </Button>
                </DialogFooter>
              </>
            )}
          </DialogContent>
        </Dialog>
      }
    >
      <ul className="divide-y">
        {accounts.data?.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
            <Building2 className="size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                {a.name}
                {a.isMine && <Badge variant="secondary">sua conta</Badge>}
                {a.pendingInvite && <Badge variant="outline">convite pendente</Badge>}
              </div>
              <div className="text-xs text-muted-foreground">
                {a.owner ? `${a.owner.name} · ${a.owner.email}` : "sem responsável"} · {a.owner?.lastLoginAt ? `último acesso ${fmtRelative(a.owner.lastLoginAt)}` : "ainda não entrou"}
              </div>
              <div className="text-xs text-muted-foreground">
                {fmtNumber(a.companies)} empresas · {fmtNumber(a.users)} {a.users === 1 ? "usuário" : "usuários"} · criada em {fmtDate(a.createdAt)}
              </div>
            </div>
            {a.pendingInvite && !a.isMine && (
              <Button size="sm" variant="outline" onClick={() => relink.mutate(a)} disabled={relink.isPending}>
                <Link2 /> Novo link
              </Button>
            )}
          </li>
        ))}
      </ul>

      <Dialog open={!!relinked} onOpenChange={(v) => !v && setRelinked(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Novo link de acesso</DialogTitle>
            <DialogDescription>Envie para {relinked?.name}. Os links gerados antes deixaram de valer.</DialogDescription>
          </DialogHeader>
          {relinked && <InviteLink key={relinked.link} link={relinked.link} />}
          <DialogFooter>
            <Button onClick={() => setRelinked(null)}>Concluir</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SectionCard>
  );
}
