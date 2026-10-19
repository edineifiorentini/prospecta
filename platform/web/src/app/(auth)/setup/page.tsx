"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, ShieldCheck } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Field } from "@/components/form-field";
import { api, errorMessage, setCsrfToken } from "@/lib/api";
import { sessionQueryKey } from "@/lib/session";

const schema = z
  .object({
    bootstrapToken: z.string().trim().min(1, "Cole o ADMIN_BOOTSTRAP_TOKEN do arquivo .env."),
    organizationName: z.string().trim().min(2, "Informe o nome da organização."),
    name: z.string().trim().min(2, "Informe seu nome."),
    email: z.string().trim().email("Informe um e-mail válido."),
    password: z.string().min(10, "Use pelo menos 10 caracteres."),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "As senhas não conferem." });
type Values = z.infer<typeof schema>;

export default function SetupPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { bootstrapToken: "", organizationName: "", name: "", email: "", password: "", confirm: "" },
  });

  useEffect(() => {
    api<{ needsSetup: boolean }>("/setup/status")
      .then((s) => (s.needsSetup ? setChecking(false) : router.replace("/login")))
      .catch(() => setChecking(false));
  }, [router]);

  const onSubmit = form.handleSubmit(async ({ confirm: _confirm, ...values }) => {
    setError(null);
    try {
      const res = await api<{ csrfToken: string }>("/setup", { method: "POST", body: values });
      setCsrfToken(res.csrfToken);
      await qc.invalidateQueries({ queryKey: sessionQueryKey });
      router.replace("/dashboard");
    } catch (err) {
      setError(errorMessage(err));
    }
  });

  const { errors, isSubmitting } = form.formState;
  if (checking) return <div className="card-soft h-[480px] animate-pulse" />;

  return (
    <div className="card-soft p-7">
      <div className="flex items-center gap-2 text-primary">
        <ShieldCheck className="size-5" />
        <span className="text-xs font-medium tracking-wide uppercase">Primeiro acesso</span>
      </div>
      <h1 className="mt-2 text-xl font-semibold tracking-tight">Configure o administrador</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Esta tela funciona uma única vez. O token está no arquivo <code className="rounded bg-muted px-1 py-0.5 text-[12px]">.env</code> da raiz
        (<code className="text-[12px]">ADMIN_BOOTSTRAP_TOKEN</code>).
      </p>
      <form onSubmit={onSubmit} className="mt-6 grid gap-4" noValidate>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <Field id="bootstrapToken" label="Token de configuração" error={errors.bootstrapToken?.message}>
          <Input id="bootstrapToken" type="password" autoComplete="off" {...form.register("bootstrapToken")} />
        </Field>
        <Field id="organizationName" label="Organização" error={errors.organizationName?.message}>
          <Input id="organizationName" placeholder="Ex.: Agência Exemplo" {...form.register("organizationName")} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="name" label="Seu nome" error={errors.name?.message}>
            <Input id="name" autoComplete="name" {...form.register("name")} />
          </Field>
          <Field id="email" label="E-mail" error={errors.email?.message}>
            <Input id="email" type="email" autoComplete="username" {...form.register("email")} />
          </Field>
        </div>
        <Field id="password" label="Senha" hint="Mínimo de 10 caracteres." error={errors.password?.message}>
          <Input id="password" type="password" autoComplete="new-password" {...form.register("password")} />
        </Field>
        <Field id="confirm" label="Confirmar senha" error={errors.confirm?.message}>
          <Input id="confirm" type="password" autoComplete="new-password" {...form.register("confirm")} />
        </Field>
        <Button type="submit" size="lg" className="mt-1 w-full" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="animate-spin" />}
          Criar administrador
        </Button>
      </form>
    </div>
  );
}
