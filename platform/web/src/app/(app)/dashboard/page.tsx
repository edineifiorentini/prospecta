"use client";

import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, XCircle } from "lucide-react";
import { PageHeader, SectionCard } from "@/components/page";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";

type Probe = { ok: boolean; ms: number; error?: string };
type Status = { db: Probe; queue: Probe; scraper: Probe; wuzapi: Probe; googleMapsEnabled: boolean };

const LABELS: Record<keyof Omit<Status, "googleMapsEnabled">, string> = {
  db: "Banco de dados (PostgreSQL)",
  queue: "Filas (Valkey/BullMQ)",
  scraper: "Motor Google Maps (gosom)",
  wuzapi: "WhatsApp (WuzAPI)",
};

export default function DashboardPage() {
  const { session } = useSession();
  const { data } = useQuery({ queryKey: ["system-status"], queryFn: () => api<Status>("/system/status"), refetchInterval: 30_000 });
  return (
    <>
      <PageHeader title={`Olá, ${session?.user.name.split(" ")[0] ?? ""}`} description="Visão geral da sua operação de prospecção." />
      <SectionCard title="Serviços" description="Estado real dos serviços integrados, verificado agora.">
        <ul className="grid gap-3 sm:grid-cols-2">
          {(Object.keys(LABELS) as (keyof typeof LABELS)[]).map((k) => {
            const p = data?.[k];
            return (
              <li key={k} className="flex items-center gap-3 rounded-lg border bg-surface px-4 py-3">
                {p?.ok ? <CheckCircle2 className="size-5 text-primary" /> : <XCircle className="size-5 text-muted-foreground" />}
                <div className="min-w-0">
                  <div className="text-sm font-medium">{LABELS[k]}</div>
                  <div className="text-xs text-muted-foreground">{!p ? "verificando…" : p.ok ? `ok · ${p.ms} ms` : `indisponível${p.error ? ` · ${p.error}` : ""}`}</div>
                </div>
              </li>
            );
          })}
        </ul>
      </SectionCard>
    </>
  );
}
