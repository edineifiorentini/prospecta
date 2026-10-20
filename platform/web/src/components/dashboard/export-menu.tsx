"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Download, FileSpreadsheet, FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { downloadFile, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";

export const EXPORTS = [
  { path: "/reports/summary.pdf", label: "Resumo de indicadores (PDF)", pdf: true },
  { path: "/reports/summary.csv", label: "Resumo de indicadores (CSV)" },
  { path: "/reports/deals.csv", label: "Negociações do funil" },
  { path: "/reports/activities.csv", label: "Atividades do período" },
  { path: "/reports/tasks.csv", label: "Tarefas" },
  { path: "/reports/messages.csv", label: "Mensagens do WhatsApp" },
] as const;

export function useExport() {
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (path: string, query?: Record<string, unknown>) => {
    setBusy(path);
    try {
      const name = await downloadFile(path, query);
      toast.success("Arquivo gerado", { description: name });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  return { busy, run };
}

/** Exportações do painel com o mesmo período e filtros da tela. */
export function ExportMenu({ query }: { query: Record<string, unknown> }) {
  const { can } = useSession();
  const { busy, run } = useExport();
  if (!can("export:run")) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={!!busy}>
          {busy ? <Loader2 className="animate-spin" /> : <Download />} Exportar
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Mesmo período e filtros da tela</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {EXPORTS.map((e) => (
          <DropdownMenuItem key={e.path} onSelect={() => run(e.path, query)}>
            {"pdf" in e ? <FileText /> : <FileSpreadsheet />} {e.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
