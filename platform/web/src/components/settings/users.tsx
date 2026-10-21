"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Copy, Loader2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Field } from "@/components/form-field";
import { SectionCard } from "@/components/page";
import { api, errorMessage } from "@/lib/api";
import { fmtRelative } from "@/lib/format";
import { ROLE_LABEL } from "@/lib/labels";
import { useSession } from "@/lib/session";

type Member = { id: string; name: string; email: string; isActive: boolean; lastLoginAt: string | null; role: string };
type Invited = { name: string; email: string; emailSent: boolean; inviteLink: string };

const ROLE_HELP: Record<string, string> = {
  OWNER: "Acesso total, inclusive outros proprietários.",
  ADMIN: "Configurações, usuários, WhatsApp, exclusões e LGPD.",
  MANAGER: "Buscas, importações, exportações e aprovação de mensagens.",
  SALES: "CRM, tarefas, enriquecimento, auditoria e conversas.",
  VIEWER: "Somente leitura.",
};

export function UsersSettings() {
  const qc = useQueryClient();
  const { session, can } = useSession();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", role: "SALES" });
  // convite recém-criado: a janela continua aberta mostrando o link para copiar
  const [invited, setInvited] = useState<Invited | null>(null);
  const [copied, setCopied] = useState(false);
  const users = useQuery({ queryKey: ["users"], queryFn: () => api<Member[]>("/users") });
  const invite = useMutation({
    mutationFn: () => api<{ emailSent: boolean; inviteLink: string }>("/users", { method: "POST", body: form }),
    onSuccess: (r) => {
      setInvited({ name: form.name, email: form.email, ...r });
      setCopied(false);
      qc.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const toggleDialog = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setInvited(null);
      setForm({ name: "", email: "", role: "SALES" });
    }
  };
  const copyLink = async () => {
    if (!invited) return;
    try {
      await navigator.clipboard.writeText(invited.inviteLink);
      setCopied(true);
      toast.success("Link copiado");
    } catch {
      toast.error("Não foi possível copiar automaticamente. Selecione o link e copie manualmente.");
    }
  };
  const update = useMutation({
    mutationFn: ({ id, ...body }: { id: string; role?: string; isActive?: boolean }) => api(`/users/${id}`, { method: "PATCH", body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const manage = can("users:manage");

  return (
    <SectionCard
      title="Usuários e permissões"
      description="Controle de acesso por papel (RBAC). Cada usuário enxerga apenas os dados da sua organização."
      bodyClassName="p-0"
      actions={
        manage && (
          <Dialog open={open} onOpenChange={toggleDialog}>
            <DialogTrigger asChild>
              <Button size="sm">
                <UserPlus /> Convidar
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              {invited ? (
                <>
                  <DialogHeader>
                    <DialogTitle>Convite criado</DialogTitle>
                    <DialogDescription>
                      {invited.emailSent ? `O link também foi enviado para ${invited.email}.` : `Não foi possível enviar o e-mail para ${invited.email}.`} Se o e-mail não chegar, copie o link e envie para {invited.name}, pelo WhatsApp, por exemplo.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="grid gap-2">
                    <div className="flex gap-2">
                      <Input readOnly value={invited.inviteLink} aria-label="Link do convite" className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
                      <Button type="button" variant="outline" onClick={copyLink}>
                        {copied ? <Check /> : <Copy />} {copied ? "Copiado" : "Copiar"}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">Uso único, válido por 72 horas. Envie só para a pessoa convidada: quem abrir o link primeiro define a senha da conta.</p>
                  </div>
                  <DialogFooter>
                    <Button onClick={() => toggleDialog(false)}>Concluir</Button>
                  </DialogFooter>
                </>
              ) : (
                <>
                  <DialogHeader>
                    <DialogTitle>Convidar usuário</DialogTitle>
                    <DialogDescription>A pessoa recebe um link de uso único (72 h) para definir a própria senha.</DialogDescription>
                  </DialogHeader>
                  <div className="grid gap-3">
                    <Field id="iu-name" label="Nome">
                      <Input id="iu-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                    </Field>
                    <Field id="iu-email" label="E-mail">
                      <Input id="iu-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                    </Field>
                    <Field id="iu-role" label="Papel" hint={ROLE_HELP[form.role]}>
                      <Select value={form.role} onValueChange={(role) => setForm({ ...form, role })}>
                        <SelectTrigger id="iu-role" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.keys(ROLE_HELP).map((r) => (
                            <SelectItem key={r} value={r}>
                              {ROLE_LABEL[r]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                  </div>
                  <DialogFooter>
                    <Button onClick={() => invite.mutate()} disabled={invite.isPending || form.name.length < 2 || !form.email.includes("@")}>
                      {invite.isPending && <Loader2 className="animate-spin" />} Enviar convite
                    </Button>
                  </DialogFooter>
                </>
              )}
            </DialogContent>
          </Dialog>
        )
      }
    >
      <ul className="divide-y">
        {users.data?.map((u) => (
          <li key={u.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">
                {u.name} {u.id === session?.user.id && <span className="text-xs text-muted-foreground">(você)</span>}
              </div>
              <div className="text-xs text-muted-foreground">
                {u.email} · último acesso {u.lastLoginAt ? fmtRelative(u.lastLoginAt) : "nunca"}
              </div>
            </div>
            <Select value={u.role} disabled={!manage || u.id === session?.user.id} onValueChange={(role) => update.mutate({ id: u.id, role })}>
              <SelectTrigger className="h-8 w-40" aria-label={`Papel de ${u.name}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.keys(ROLE_HELP).map((r) => (
                  <SelectItem key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              Ativo
              <Switch checked={u.isActive} disabled={!manage || u.id === session?.user.id} onCheckedChange={(isActive) => update.mutate({ id: u.id, isActive })} />
            </label>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}
