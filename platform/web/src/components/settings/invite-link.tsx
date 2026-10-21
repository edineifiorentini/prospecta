"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Link de uso único para definir a senha, com botão de copiar (para enviar pelo WhatsApp quando o e-mail não chega). */
export function InviteLink({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const copy = async () => {
    let ok = false;
    try {
      await navigator.clipboard.writeText(link);
      ok = true;
    } catch {
      // navegadores que bloqueiam a área de transferência: copia o texto selecionado do campo
      ref.current?.select();
      ok = document.execCommand("copy");
    }
    if (ok) {
      setCopied(true);
      toast.success("Link copiado");
    } else toast.error("Não foi possível copiar automaticamente. Selecione o link e copie manualmente.");
  };
  return (
    <div className="grid gap-2">
      <div className="flex gap-2">
        <Input ref={ref} readOnly value={link} aria-label="Link para definir a senha" className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
        <Button type="button" variant="outline" onClick={copy}>
          {copied ? <Check /> : <Copy />} {copied ? "Copiado" : "Copiar"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">Uso único, válido por 72 horas. Envie só para essa pessoa: quem abrir o link primeiro define a senha da conta.</p>
    </div>
  );
}
