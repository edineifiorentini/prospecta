"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, LogOut, Monitor } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/form-field";
import { SectionCard } from "@/components/page";
import { StatusBadge } from "@/components/status-badge";
import { api, errorMessage, setCsrfToken } from "@/lib/api";
import { fmtDateTime, fmtRelative } from "@/lib/format";
import { sessionQueryKey, useSession } from "@/lib/session";
import { ROLE_LABEL } from "@/lib/labels";

const schema = z
  .object({ currentPassword: z.string().min(1, "Informe a senha atual."), newPassword: z.string().min(10, "Mínimo de 10 caracteres."), confirm: z.string() })
  .refine((v) => v.newPassword === v.confirm, { path: ["confirm"], message: "As senhas não conferem." });

type SessionRow = { id: string; ip: string | null; userAgent: string | null; createdAt: string; lastSeenAt: string; current: boolean };

export function AccountSettings() {
  const { session } = useSession();
  const qc = useQueryClient();
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { currentPassword: "", newPassword: "", confirm: "" } });
  const sessions = useQuery({ queryKey: ["sessions"], queryFn: () => api<SessionRow[]>("/auth/sessions") });
  const change = useMutation({
    mutationFn: (v: z.infer<typeof schema>) => api<{ csrfToken: string }>("/auth/password", { method: "POST", body: { currentPassword: v.currentPassword, newPassword: v.newPassword } }),
    onSuccess: (r) => {
      setCsrfToken(r.csrfToken);
      qc.invalidateQueries({ queryKey: sessionQueryKey });
      qc.invalidateQueries({ queryKey: ["sessions"] });
      form.reset();
      toast.success("Senha alterada", { description: "As outras sessões foram encerradas." });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const revoke = useMutation({ mutationFn: (id: string) => api(`/auth/sessions/${id}`, { method: "DELETE" }), onSuccess: () => qc.invalidateQueries({ queryKey: ["sessions"] }) });
  const e = form.formState.errors;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <SectionCard title="Seu perfil">
        <dl className="grid gap-2 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Nome</dt>
            <dd>{session?.user.name}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">E-mail</dt>
            <dd>{session?.user.email}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Papel</dt>
            <dd>{session && ROLE_LABEL[session.role]}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Organização</dt>
            <dd>{session?.organization?.name}</dd>
          </div>
        </dl>
      </SectionCard>
      <SectionCard title="Trocar senha" description="Senhas são armazenadas com Argon2id; nunca em texto.">
        <form className="grid gap-3" onSubmit={form.handleSubmit((v) => change.mutate(v))} noValidate>
          <Field id="cp" label="Senha atual" error={e.currentPassword?.message}>
            <Input id="cp" type="password" autoComplete="current-password" {...form.register("currentPassword")} />
          </Field>
          <Field id="np" label="Nova senha" error={e.newPassword?.message}>
            <Input id="np" type="password" autoComplete="new-password" {...form.register("newPassword")} />
          </Field>
          <Field id="cf" label="Confirmar" error={e.confirm?.message}>
            <Input id="cf" type="password" autoComplete="new-password" {...form.register("confirm")} />
          </Field>
          <Button type="submit" className="justify-self-end" disabled={change.isPending}>
            {change.isPending && <Loader2 className="animate-spin" />} Alterar senha
          </Button>
        </form>
      </SectionCard>
      <SectionCard title="Sessões ativas" description="Encerre sessões que você não reconhece." className="lg:col-span-2" bodyClassName="p-0">
        <ul className="divide-y">
          {sessions.data?.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
              <Monitor className="size-4 text-muted-foreground" />
              <span className="max-w-md truncate">{s.userAgent ?? "Navegador desconhecido"}</span>
              <span className="text-xs text-muted-foreground">
                {s.ip} · iniciada {fmtDateTime(s.createdAt)} · ativa {fmtRelative(s.lastSeenAt)}
              </span>
              {s.current ? (
                <StatusBadge tone="success" className="ml-auto">
                  Esta sessão
                </StatusBadge>
              ) : (
                <Button variant="ghost" size="sm" className="ml-auto" onClick={() => revoke.mutate(s.id)}>
                  <LogOut /> Encerrar
                </Button>
              )}
            </li>
          ))}
        </ul>
      </SectionCard>
    </div>
  );
}
