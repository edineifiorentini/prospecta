"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Field } from "@/components/form-field";
import { api, errorMessage, setCsrfToken } from "@/lib/api";
import { sessionQueryKey } from "@/lib/session";

const schema = z.object({
  email: z.string().trim().email("Informe um e-mail válido."),
  password: z.string().min(1, "Informe a senha."),
});
type Values = z.infer<typeof schema>;

function safeNext(raw: string | null) {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/dashboard";
  return raw;
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { email: "", password: "" } });

  useEffect(() => {
    api<{ needsSetup: boolean }>("/setup/status")
      .then((s) => s.needsSetup && router.replace("/setup"))
      .catch(() => undefined);
  }, [router]);

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      const res = await api<{ csrfToken: string; mustChangePassword: boolean }>("/auth/login", { method: "POST", body: values });
      setCsrfToken(res.csrfToken);
      await qc.invalidateQueries({ queryKey: sessionQueryKey });
      router.replace(res.mustChangePassword ? "/trocar-senha" : safeNext(params.get("next")));
    } catch (err) {
      setError(errorMessage(err));
    }
  });

  const { errors, isSubmitting } = form.formState;
  return (
    <div className="card-soft p-7">
      <h1 className="text-xl font-semibold tracking-tight">Entrar</h1>
      <p className="mt-1 text-sm text-muted-foreground">Acesse sua central de prospecção.</p>
      <form onSubmit={onSubmit} className="mt-6 grid gap-4" noValidate>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <Field id="email" label="E-mail" error={errors.email?.message}>
          <Input id="email" type="email" autoComplete="username" autoFocus aria-invalid={!!errors.email} {...form.register("email")} />
        </Field>
        <Field id="password" label="Senha" error={errors.password?.message}>
          <Input id="password" type="password" autoComplete="current-password" aria-invalid={!!errors.password} {...form.register("password")} />
        </Field>
        <Button type="submit" size="lg" className="mt-1 w-full" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="animate-spin" />}
          Entrar
        </Button>
        <Link href="/esqueci-senha" className="text-center text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
          Esqueci minha senha
        </Link>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
