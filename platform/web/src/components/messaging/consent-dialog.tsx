"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field } from "@/components/form-field";
import { api, errorMessage } from "@/lib/api";
import { fmtPhone } from "@/lib/format";

/** Registro de autorização de contato: fonte, data e evidência obrigatórias. */
export function ConsentDialog({ phone, companyId, trigger }: { phone?: string; companyId?: string; trigger?: React.ReactNode }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ contactValue: phone ?? "", legalBasis: "CONSENT", source: "", evidence: "", grantedAt: new Date().toISOString().slice(0, 10) });
  const save = useMutation({
    mutationFn: () => api("/consents", { method: "POST", body: { ...form, companyId, grantedAt: new Date(form.grantedAt).toISOString() } }),
    onSuccess: () => {
      toast.success("Autorização registrada");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["conversation"] });
      qc.invalidateQueries({ queryKey: ["consents"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm">
            <ShieldCheck /> Registrar autorização
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Autorização para contato via WhatsApp</DialogTitle>
          <DialogDescription>
            Registre apenas autorizações reais e verificáveis. Um número publicado na internet não é autorização para iniciar conversas comerciais.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Field id="cs-phone" label="Número">
            <Input id="cs-phone" value={phone ? fmtPhone(form.contactValue) : form.contactValue} disabled={!!phone} onChange={(e) => setForm({ ...form, contactValue: e.target.value })} placeholder="(19) 99999-0000" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field id="cs-basis" label="Base legal (LGPD)">
              <Select value={form.legalBasis} onValueChange={(legalBasis) => setForm({ ...form, legalBasis })}>
                <SelectTrigger id="cs-basis" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CONSENT">Consentimento</SelectItem>
                  <SelectItem value="CONTRACT">Execução de contrato</SelectItem>
                  <SelectItem value="LEGITIMATE_INTEREST">Legítimo interesse (documentado)</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field id="cs-date" label="Data da autorização">
              <Input id="cs-date" type="date" value={form.grantedAt} onChange={(e) => setForm({ ...form, grantedAt: e.target.value })} />
            </Field>
          </div>
          <Field id="cs-source" label="Fonte" hint="Ex.: formulário do site, pedido em ligação, evento, cliente ativo">
            <Input id="cs-source" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} />
          </Field>
          <Field id="cs-evidence" label="Evidência" hint="O que comprova a autorização (protocolo, gravação, print, e-mail).">
            <Textarea id="cs-evidence" rows={3} value={form.evidence} onChange={(e) => setForm({ ...form, evidence: e.target.value })} />
          </Field>
        </div>
        <DialogFooter>
          <Button onClick={() => save.mutate()} disabled={save.isPending || form.source.trim().length < 3 || form.evidence.trim().length < 3 || form.contactValue.length < 8}>
            {save.isPending && <Loader2 className="animate-spin" />} Registrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
