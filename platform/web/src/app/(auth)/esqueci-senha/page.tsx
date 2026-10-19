"use client";

import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Field } from "@/components/form-field";
import { api, errorMessage } from "@/lib/api";

const schema = z.object({ email: z.string().trim().email("Informe um e-mail válido.") });

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { email: "" } });

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await api("/auth/forgot", { method: "POST", body: values });
      setSent(true);
    } catch (err) {
      setError(errorMessage(err));
    }
  });

  return (
    <div className="card-soft p-7">
      {sent ? (
        <div className="text-center">
          <MailCheck className="mx-auto size-10 text-primary" />
          <h1 className="mt-3 text-lg font-semibold">Verifique seu e-mail</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Se o endereço estiver cadastrado, enviamos um link válido por 30 minutos. Em ambiente local, as mensagens ficam no Mailpit
            (<span className="font-mono text-xs">http://localhost:8025</span>).
          </p>
          <Button asChild variant="outline" className="mt-6 w-full">
            <Link href="/login">Voltar ao login</Link>
          </Button>
        </div>
      ) : (
        <>
          <h1 className="text-xl font-semibold tracking-tight">Recuperar acesso</h1>
          <p className="mt-1 text-sm text-muted-foreground">Enviaremos um link seguro de redefinição de senha.</p>
          <form onSubmit={onSubmit} className="mt-6 grid gap-4" noValidate>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Field id="email" label="E-mail" error={form.formState.errors.email?.message}>
              <Input id="email" type="email" autoComplete="username" autoFocus {...form.register("email")} />
            </Field>
            <Button type="submit" size="lg" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting && <Loader2 className="animate-spin" />}
              Enviar link
            </Button>
            <Link href="/login" className="text-center text-sm text-muted-foreground hover:text-foreground">
              Voltar ao login
            </Link>
          </form>
        </>
      )}
    </div>
  );
}
