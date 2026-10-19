"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { KanbanSquare, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";

/** Ações em massa sobre empresas selecionadas: enriquecer sites e enviar ao CRM. */
export function BulkCompanyActions({ companyIds, onDone }: { companyIds: string[]; onDone?: () => void }) {
  const qc = useQueryClient();
  const { can } = useSession();

  const enrich = useMutation({
    mutationFn: () => api<{ queued: number; skipped: number }>("/enrichment/bulk", { method: "POST", body: { companyIds } }),
    onSuccess: (r) => {
      toast.success(`${r.queued} empresa(s) na fila de enriquecimento`, { description: r.skipped ? `${r.skipped} ignorada(s): sem site ou já em processamento.` : undefined });
      qc.invalidateQueries();
      onDone?.();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const toCrm = useMutation({
    mutationFn: () => api<{ created: number; skipped: number }>("/deals/bulk", { method: "POST", body: { companyIds } }),
    onSuccess: (r) => {
      toast.success(`${r.created} lead(s) enviado(s) ao CRM`, { description: r.skipped ? `${r.skipped} já tinham negociação aberta.` : undefined });
      qc.invalidateQueries();
      onDone?.();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <>
      {can("enrich:run") && (
        <Button variant="outline" size="sm" onClick={() => enrich.mutate()} disabled={enrich.isPending || !companyIds.length}>
          {enrich.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />} Enriquecer
        </Button>
      )}
      {can("crm:write") && (
        <Button size="sm" onClick={() => toCrm.mutate()} disabled={toCrm.isPending || !companyIds.length}>
          {toCrm.isPending ? <Loader2 className="animate-spin" /> : <KanbanSquare />} Adicionar ao CRM
        </Button>
      )}
    </>
  );
}
