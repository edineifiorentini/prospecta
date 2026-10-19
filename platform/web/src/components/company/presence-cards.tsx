"use client";

import Link from "next/link";
import { AlertTriangle, CheckCircle2, ExternalLink, Globe, Lock, LockOpen, ShieldQuestion, XCircle } from "lucide-react";
import { SectionCard } from "@/components/page";
import { StatusBadge, dataTone } from "@/components/status-badge";
import { DATA_STATUS_LABEL, SOCIAL_LABEL, SOURCE_LABEL } from "@/lib/labels";
import { fmtDateTime, fmtRelative } from "@/lib/format";
import type { CompanyDetail } from "./types";

export function SocialCard({ socials }: { socials: CompanyDetail["socialProfiles"] }) {
  return (
    <SectionCard title="Redes sociais" description="Somente perfis com evidência; nenhum número de seguidores é estimado." bodyClassName="p-0">
      {socials.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted-foreground">Nenhum perfil identificado. Isso não significa que a empresa não tenha redes — apenas que não encontramos evidência pública.</p>
      ) : (
        <ul className="divide-y">
          {socials.map((s) => (
            <li key={s.id} className="flex items-start gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{SOCIAL_LABEL[s.network] ?? s.network}</span>
                  <a href={s.url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 truncate text-sm text-primary hover:underline">
                    {s.handle} <ExternalLink className="size-3" />
                  </a>
                  <StatusBadge tone={dataTone(s.status)}>{s.status === "VERIFIED" ? "Vínculo confirmado" : s.status === "INVALID" ? "Perfil não encontrado" : DATA_STATUS_LABEL[s.status]}</StatusBadge>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {s.evidence ?? `Fonte: ${SOURCE_LABEL[s.source] ?? s.source}`} · confiança {Math.round(s.confidence * 100)}%
                  {s.lastCheckedAt && ` · link verificado ${fmtRelative(s.lastCheckedAt)}${s.httpStatus ? ` (HTTP ${s.httpStatus})` : ""}`}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

function Flag({ ok, label, unknown }: { ok: boolean | null | undefined; label: string; unknown?: string }) {
  const Icon = ok == null ? ShieldQuestion : ok ? CheckCircle2 : XCircle;
  return (
    <li className="flex items-center gap-2 text-sm">
      <Icon className={`size-4 ${ok == null ? "text-muted-foreground" : ok ? "text-success" : "text-destructive"}`} />
      <span className={ok == null ? "text-muted-foreground" : ""}>{ok == null ? (unknown ?? `${label}: não avaliado`) : label}</span>
    </li>
  );
}

export function WebsiteCard({ company }: { company: CompanyDetail }) {
  const site = company.websites[0];
  const job = company.enrichmentJobs[0];
  const d = (job?.details ?? {}) as Record<string, unknown> & { inconsistencies?: string[]; pages?: { url: string; status: number; title: string | null; rendered: string }[]; robots?: { blocked: string[]; found: boolean }; servicesSnippet?: string; cnpj?: { razaoSocial: string | null; situacao: string | null; cnae: string | null; sourceUrl: string } | null; reason?: string };
  const signals = (site?.signals ?? {}) as Record<string, unknown>;
  return (
    <SectionCard
      title="Site oficial"
      description={site?.lastCheckedAt ? `Última verificação ${fmtDateTime(site.lastCheckedAt)}` : "Ainda não analisado"}
      actions={
        company.website && (
          <a href={company.website} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
            <Globe className="size-3.5" /> Abrir site
          </a>
        )
      }
    >
      {!company.website ? (
        <p className="text-sm text-muted-foreground">Nenhum site informado pelas fontes consultadas.</p>
      ) : !site ? (
        <p className="text-sm text-muted-foreground">{d.reason ?? "Use “Enriquecer” para visitar o site (respeitando robots.txt) e buscar contatos e redes sociais públicas."}</p>
      ) : (
        <div className="grid gap-4">
          <ul className="grid gap-1.5 sm:grid-cols-2">
            <Flag ok={site.isReachable} label={site.isReachable ? `Site no ar (HTTP ${site.httpStatus}, ${site.responseTimeMs} ms)` : `Site inacessível${site.httpStatus ? ` (HTTP ${site.httpStatus})` : ""}`} />
            <li className="flex items-center gap-2 text-sm">
              {site.https ? <Lock className="size-4 text-success" /> : <LockOpen className="size-4 text-destructive" />}
              {site.https ? "HTTPS ativo" : signals.httpsAvailable ? "Aceita HTTPS, mas não redireciona automaticamente" : "Sem HTTPS"}
            </li>
            <Flag ok={site.robotsAllowed} label={site.robotsAllowed ? "Acesso automatizado permitido (robots.txt)" : "robots.txt restringe acesso automatizado"} />
            <Flag ok={(signals.sitemap as boolean | undefined) ?? null} label={signals.sitemap ? "Sitemap encontrado" : "Sitemap não encontrado"} />
          </ul>
          {site.title && (
            <div className="rounded-lg bg-muted/50 p-3 text-sm">
              <div className="font-medium">{site.title}</div>
              {site.metaDescription && <div className="mt-0.5 text-xs text-muted-foreground">{site.metaDescription}</div>}
            </div>
          )}
          {d.cnpj && (
            <div className="text-sm">
              <span className="font-medium">CNPJ (Receita Federal via BrasilAPI): </span>
              {d.cnpj.razaoSocial} · {d.cnpj.situacao} {d.cnpj.cnae && <span className="text-muted-foreground">· {d.cnpj.cnae}</span>}
            </div>
          )}
          {d.servicesSnippet && (
            <div>
              <div className="text-xs font-medium text-muted-foreground">Serviços/descrição publicados</div>
              <p className="mt-1 text-sm text-pretty">{d.servicesSnippet}</p>
            </div>
          )}
          {!!d.inconsistencies?.length && (
            <div className="rounded-lg border border-warning/40 bg-warning-soft/50 p-3">
              <div className="flex items-center gap-1.5 text-sm font-medium">
                <AlertTriangle className="size-4 text-warning" /> Possíveis inconsistências
              </div>
              <ul className="mt-1 list-disc pl-5 text-sm">
                {d.inconsistencies.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            </div>
          )}
          {!!d.pages?.length && (
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer">Páginas visitadas ({d.pages.length})</summary>
              <ul className="mt-1 grid gap-0.5">
                {d.pages.map((p) => (
                  <li key={p.url} className="truncate">
                    {p.status} · {p.url} {p.rendered === "browser" && "(renderizada com navegador)"}
                  </li>
                ))}
                {d.robots?.blocked?.map((u) => (
                  <li key={u} className="truncate">
                    bloqueada pelo robots.txt · {u}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </SectionCard>
  );
}

export function SourcesCard({ company }: { company: CompanyDetail }) {
  return (
    <SectionCard title="Fontes e histórico de descoberta" bodyClassName="p-0">
      <ul className="divide-y text-sm">
        {company.leadSources.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5">
            <span className="font-medium">{SOURCE_LABEL[s.sourceType] ?? s.sourceType}</span>
            {s.searchJob ? (
              <Link href={`/buscar/${s.searchJob.id}`} className="truncate text-primary hover:underline">
                {s.searchJob.name}
              </Link>
            ) : (
              s.sourceRef && <span className="truncate text-muted-foreground">{s.sourceRef}</span>
            )}
            <span className="ml-auto text-xs text-muted-foreground">{fmtDateTime(s.collectedAt)}</span>
            {s.sourceUrl && (
              <a href={s.sourceUrl} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                ficha pública <ExternalLink className="size-3" />
              </a>
            )}
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}
