"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { KeyRound, Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Field } from "@/components/form-field";
import { api, errorMessage, setCsrfToken } from "@/lib/api";
import { sessionQueryKey, useSession } from "@/lib/session";

const schema = z
  .object({
    currentPassword: z.string().min(1, "Informe a senha temporária."),
    newPassword: z.string().min(10, "Use pelo menos 10 caracteres."),
    confirm: z.string(),
  })
  .refine((v) => v.newPassword === v.confirm, { path: ["confirm"], message: "As senhas não conferem." })
  .refine((v) => v.newPassword !== v.currentPassword, { path: ["newPassword"], message: "A nova senha precisa ser diferente da temporária." });

/** Troca obrigatória da senha temporária no primeiro acesso. */
export default function ChangePasswordPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { session, loading } = useSession();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { currentPassword: "", newPassword: "", confirm: "" } });

  useEffect(() => {
    if (loading) return;
    if (!session) router.replace("/login");
    else if (!session.mustChangePassword) router.replace("/dashboard");
  }, [loading, session, router]);

  const onSubmit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      const r = await api<{ csrfToken: string }>("/auth/password", { method: "POST", body: { currentPassword: v.currentPassword, newPassword: v.newPassword } });
      setCsrfToken(r.csrfToken);
      await qc.invalidateQueries({ queryKey: sessionQueryKey });
      router.replace("/dashboard");
    } catch (err) {
      setError(errorMessage(err));
    }
  });

  const e = form.formState.errors;
  return (
    <div className="card-soft p-7">
      <div className="flex items-center gap-3">
        <span className="flex size-9 items-center justify-center rounded-full bg-accent text-primary">
          <KeyRound className="size-4" />
        </span>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Defina sua senha</h1>
          <p className="text-sm text-muted-foreground">{session?.user.email ?? "Primeiro acesso"}</p>
        </div>
      </div>
      <p className="mt-4 text-sm text-muted-foreground">Você entrou com uma senha temporária. Escolha uma senha pessoal para continuar.</p>
      <form onSubmit={onSubmit} className="mt-6 grid gap-4" noValidate>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <Field id="currentPassword" label="Senha temporária" error={e.currentPassword?.message}>
          <Input id="currentPassword" type="password" autoComplete="current-password" autoFocus {...form.register("currentPassword")} />
        </Field>
        <Field id="newPassword" label="Nova senha" hint="Mínimo de 10 caracteres, evite senhas comuns." error={e.newPassword?.message}>
          <Input id="newPassword" type="password" autoComplete="new-password" {...form.register("newPassword")} />
        </Field>
        <Field id="confirm" label="Confirmar nova senha" error={e.confirm?.message}>
          <Input id="confirm" type="password" autoComplete="new-password" {...form.register("confirm")} />
        </Field>
        <Button type="submit" size="lg" disabled={form.formState.isSubmitting || loading}>
          {form.formState.isSubmitting && <Loader2 className="animate-spin" />}
          Salvar e continuar
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={async () => {
            await api("/auth/logout", { method: "POST" }).catch(() => undefined);
            await qc.invalidateQueries({ queryKey: sessionQueryKey });
            router.replace("/login");
          }}
        >
          Sair
        </Button>
      </form>
    </div>
  );
}
