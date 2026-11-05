"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Building2, KanbanSquare, Loader2, Sparkles } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";

type DataSettings = { settings: { enabled: boolean; maxBatchSize: number; maxDailyRequests: number }; configured: boolean; simulated: boolean; usage: { requests: number; tokens: number } };

/** Ações em massa sobre empresas selecionadas: enriquecer sites, dados empresariais (pago) e enviar ao CRM. */
export function BulkCompanyActions({ companyIds, onDone }: { companyIds: string[]; onDone?: () => void }) {
  const qc = useQueryClient();
  const { can } = useSession();
  const [confirmData, setConfirmData] = useState(false);
  const dataSettings = useQuery({ queryKey: ["business-data-settings"], queryFn: () => api<DataSettings>("/business-data/settings"), enabled: can("enrich:run"), staleTime: 60_000 });
  const ds = dataSettings.data;

  const enrich = useMutation({
    mutationFn: () => api<{ queued: number; skipped: number }>("/enrichment/bulk", { method: "POST", body: { companyIds } }),
    onSuccess: (r) => {
      toast.success(`${r.queued} empresa(s) na fila de enriquecimento`, { description: r.skipped ? `${r.skipped} ignorada(s): sem site ou já em processamento.` : undefined });
      qc.invalidateQueries();
      onDone?.();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const enrichData = useMutation({
    mutationFn: () => api<{ queued: number; ignored: number }>("/business-data/batch", { method: "POST", body: { companyIds } }),
    onSuccess: (r) => {
      setConfirmData(false);
      toast.success(`${r.queued} empresa(s) na fila de dados empresariais`, { description: "Cada consulta confere o custo e os limites da conta antes de ser feita." });
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

  const tooMany = !!ds && companyIds.length > ds.settings.maxBatchSize;

  return (
    <>
      {can("enrich:run") && (
        <Button variant="outline" size="sm" onClick={() => enrich.mutate()} disabled={enrich.isPending || !companyIds.length}>
          {enrich.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />} Enriquecer
        </Button>
      )}
      {can("enrich:run") && ds?.settings.enabled && ds.configured && (
        <Button variant="outline" size="sm" onClick={() => setConfirmData(true)} disabled={enrichData.isPending || !companyIds.length}>
          {enrichData.isPending ? <Loader2 className="animate-spin" /> : <Building2 />} Dados empresariais
        </Button>
      )}
      {can("crm:write") && (
        <Button size="sm" onClick={() => toCrm.mutate()} disabled={toCrm.isPending || !companyIds.length}>
          {toCrm.isPending ? <Loader2 className="animate-spin" /> : <KanbanSquare />} Adicionar ao CRM
        </Button>
      )}

      <AlertDialog open={confirmData} onOpenChange={setConfirmData}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Consultar dados empresariais de {companyIds.length} empresa(s)?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="grid gap-2 text-sm">
                <span>São consultas pagas na Econodata, feitas pela fila com ritmo controlado. Antes de cada uma, o custo é conferido e os limites da conta são respeitados; empresas ambíguas ficam aguardando confirmação, sem consulta completa.</span>
                {ds && (
                  <span>
                    Hoje: {ds.usage.requests} de {ds.settings.maxDailyRequests} consultas. Lote de até {ds.settings.maxBatchSize} empresas.
                  </span>
                )}
                {tooMany && <span className="font-medium text-destructive">Selecione no máximo {ds!.settings.maxBatchSize} empresas por lote.</span>}
                {ds?.simulated && <span className="text-muted-foreground">Modo simulado: nada é cobrado de verdade.</span>}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={enrichData.isPending || tooMany}
              onClick={(e) => {
                e.preventDefault();
                enrichData.mutate();
              }}
            >
              {enrichData.isPending && <Loader2 className="animate-spin" />} Enviar para a fila
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
