"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/form-field";
import { api, errorMessage } from "@/lib/api";

const schema = z.object({
  name: z.string().trim().min(2, "Informe o nome."),
  category: z.string().trim().optional(),
  website: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  email: z.string().trim().email("E-mail inválido.").optional().or(z.literal("")),
  address: z.string().trim().optional(),
  neighborhood: z.string().trim().optional(),
  city: z.string().trim().optional(),
  state: z.string().trim().optional(),
});
type Values = z.infer<typeof schema>;

export function NewCompanyDialog() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const qc = useQueryClient();
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { name: "" } });
  const create = useMutation({
    mutationFn: (v: Values) => {
      const body = Object.fromEntries(Object.entries(v).filter(([, x]) => x !== "" && x !== undefined));
      return api<{ id: string; isNew: boolean; matchedBy: string | null }>("/companies", { method: "POST", body });
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["companies"] });
      setOpen(false);
      form.reset();
      if (r.isNew) toast.success("Empresa cadastrada");
      else toast.info("Essa empresa já existia", { description: "Os dados novos foram somados ao cadastro existente." });
      router.push(`/empresas/${r.id}`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const e = form.formState.errors;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" data-tour="new-company">
          <Plus /> Nova empresa
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Cadastro manual</DialogTitle>
          <DialogDescription>Verificamos duplicidade por nome, site, telefone e endereço antes de criar.</DialogDescription>
        </DialogHeader>
        <form id="new-company" onSubmit={form.handleSubmit((v) => create.mutate(v))} className="grid gap-3" noValidate>
          <Field id="nc-name" label="Nome comercial" error={e.name?.message}>
            <Input id="nc-name" autoFocus {...form.register("name")} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="nc-category" label="Categoria" optional>
              <Input id="nc-category" {...form.register("category")} />
            </Field>
            <Field id="nc-website" label="Site" optional>
              <Input id="nc-website" placeholder="empresa.com.br" {...form.register("website")} />
            </Field>
            <Field id="nc-phone" label="Telefone" optional>
              <Input id="nc-phone" placeholder="(19) 3333-4444" {...form.register("phone")} />
            </Field>
            <Field id="nc-email" label="E-mail comercial" optional error={e.email?.message}>
              <Input id="nc-email" type="email" {...form.register("email")} />
            </Field>
          </div>
          <Field id="nc-address" label="Endereço" optional>
            <Input id="nc-address" {...form.register("address")} />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field id="nc-neighborhood" label="Bairro" optional>
              <Input id="nc-neighborhood" {...form.register("neighborhood")} />
            </Field>
            <Field id="nc-city" label="Cidade" optional>
              <Input id="nc-city" {...form.register("city")} />
            </Field>
            <Field id="nc-state" label="UF" optional>
              <Input id="nc-state" {...form.register("state")} />
            </Field>
          </div>
        </form>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button type="submit" form="new-company" disabled={create.isPending}>
            {create.isPending && <Loader2 className="animate-spin" />}
            Cadastrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
