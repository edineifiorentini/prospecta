"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, ExternalLink, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionCard } from "@/components/page";
import { api } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import type { Page } from "@/lib/types";

type Probe = { ok: boolean; ms: number; error?: string };

export function SystemSettings() {
  const status = useQuery({ queryKey: ["system-status"], queryFn: () => api<{ db: Probe; queue: Probe; scraper: Probe; wuzapi: Probe; version: string }>("/system/status"), refetchInterval: 30_000 });
  const rows: [string, Probe | undefined][] = [
    ["PostgreSQL", status.data?.db],
    ["Valkey / BullMQ", status.data?.queue],
    ["Google Maps Scraper (gosom)", status.data?.scraper],
    ["WuzAPI (WhatsApp)", status.data?.wuzapi],
  ];
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <SectionCard title="Serviços" description={`Prospecta ${status.data?.version ?? ""}`}>
        <ul className="grid gap-2">
          {rows.map(([label, p]) => (
            <li key={label} className="flex items-center gap-2 text-sm">
              {p?.ok ? <CheckCircle2 className="size-4 text-success" /> : <XCircle className="size-4 text-muted-foreground" />}
              {label}
              <span className="ml-auto text-xs text-muted-foreground">{!p ? "…" : p.ok ? `${p.ms} ms` : (p.error ?? "indisponível")}</span>
            </li>
          ))}
        </ul>
        <a href="/api/docs" target="_blank" rel="noopener" className="mt-4 inline-flex items-center gap-1 text-sm text-primary hover:underline">
          Documentação da API (OpenAPI) <ExternalLink className="size-3.5" />
        </a>
      </SectionCard>
      <SectionCard title="Créditos e licenças">
        <ul className="grid gap-2 text-sm">
          <li>
            Motor de coleta <a className="text-primary hover:underline" href="https://github.com/gosom/google-maps-scraper" target="_blank" rel="noopener noreferrer">google-maps-scraper</a> — Georgios Komninos (MIT).
          </li>
          <li>Kit de instalação google-maps-scraper-kit (MIT) — base deste fork.</li>
          <li>Desenho dos mapas e localização das cidades © colaboradores do OpenStreetMap (ODbL 1.0), via Nominatim e Photon; empresas pesquisadas no Google Maps pelo motor gosom.</li>
          <li>
            WhatsApp via <a className="text-primary hover:underline" href="https://github.com/asternic/wuzapi" target="_blank" rel="noopener noreferrer">WuzAPI</a> (MIT) — solução não oficial; para uso comercial em escala, prefira a API oficial.
          </li>
          <li>CNPJ: dados públicos da Receita Federal via BrasilAPI.</li>
        </ul>
      </SectionCard>
    </div>
  );
}

type Log = { id: string; action: string; entityType: string | null; entityId: string | null; ip: string | null; metadata: Record<string, unknown>; createdAt: string; user: { name: string; email: string } | null };

export function AuditLogSettings() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState("");
  const q = useQuery({ queryKey: ["audit-logs", page, action], queryFn: () => api<Page<Log>>("/audit-logs", { query: { page, pageSize: 30, action: action || undefined } }), placeholderData: (p) => p });
  return (
    <SectionCard
      title="Trilha de auditoria"
      description="Registros de acesso, alterações e operações sensíveis (sem senhas ou tokens)."
      bodyClassName="p-0"
      actions={<Input className="h-8 w-56" placeholder="Filtrar ação (ex.: auth.)" value={action} onChange={(e) => (setAction(e.target.value), setPage(1))} aria-label="Filtrar por ação" />}
    >
      <ul className="divide-y text-sm">
        {q.data?.items.map((l) => (
          <li key={l.id} className="grid gap-0.5 px-5 py-2.5 sm:grid-cols-[11rem_14rem_1fr]">
            <span className="text-xs text-muted-foreground">{fmtDateTime(l.createdAt)}</span>
            <span className="font-mono text-xs">{l.action}</span>
            <span className="truncate text-xs text-muted-foreground">
              {l.user?.name ?? "sistema"} {l.ip && `· ${l.ip}`} {Object.keys(l.metadata ?? {}).length > 0 && `· ${JSON.stringify(l.metadata).slice(0, 120)}`}
            </span>
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-end gap-2 border-t px-5 py-2.5 text-xs text-muted-foreground">
        Página {page} de {q.data?.pageCount ?? 1}
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
          Anterior
        </Button>
        <Button variant="outline" size="sm" disabled={page >= (q.data?.pageCount ?? 1)} onClick={() => setPage(page + 1)}>
          Próxima
        </Button>
      </div>
    </SectionCard>
  );
}
