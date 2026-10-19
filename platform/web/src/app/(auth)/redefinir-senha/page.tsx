"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Field } from "@/components/form-field";
import { api, errorMessage } from "@/lib/api";

const schema = z
  .object({ password: z.string().min(10, "Use pelo menos 10 caracteres."), confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "As senhas não conferem." });

function ResetForm() {
  const token = useSearchParams().get("token") ?? "";
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { password: "", confirm: "" } });

  const onSubmit = form.handleSubmit(async ({ password }) => {
    setError(null);
    try {
      await api("/auth/reset", { method: "POST", body: { token, password } });
      setDone(true);
    } catch (err) {
      setError(errorMessage(err));
    }
  });

  if (!token)
    return (
      <div className="card-soft p-7 text-sm">
        Link incompleto. <Link className="text-primary underline" href="/esqueci-senha">Peça um novo link</Link>.
      </div>
    );

  return (
    <div className="card-soft p-7">
      {done ? (
        <div className="text-center">
          <CheckCircle2 className="mx-auto size-10 text-primary" />
          <h1 className="mt-3 text-lg font-semibold">Senha redefinida</h1>
          <p className="mt-1 text-sm text-muted-foreground">Todas as sessões anteriores foram encerradas por segurança.</p>
          <Button asChild className="mt-6 w-full">
            <Link href="/login">Entrar</Link>
          </Button>
        </div>
      ) : (
        <>
          <h1 className="text-xl font-semibold tracking-tight">Nova senha</h1>
          <form onSubmit={onSubmit} className="mt-6 grid gap-4" noValidate>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Field id="password" label="Nova senha" hint="Mínimo de 10 caracteres." error={form.formState.errors.password?.message}>
              <Input id="password" type="password" autoComplete="new-password" autoFocus {...form.register("password")} />
            </Field>
            <Field id="confirm" label="Confirmar" error={form.formState.errors.confirm?.message}>
              <Input id="confirm" type="password" autoComplete="new-password" {...form.register("confirm")} />
            </Field>
            <Button type="submit" size="lg" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting && <Loader2 className="animate-spin" />}
              Salvar nova senha
            </Button>
          </form>
        </>
      )}
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetForm />
    </Suspense>
  );
}
