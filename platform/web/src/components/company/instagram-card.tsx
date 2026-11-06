"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AtSign, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { SectionCard } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, errorMessage } from "@/lib/api";
import { fmtDateTime, fmtNumber } from "@/lib/format";
import { useSession } from "@/lib/session";

type Details = {
  username: string;
  biography: string | null;
  website: string | null;
  followersCount: number | null;
  mediaCount: number | null;
  fetchedAt: string;
  simulated: boolean;
  found: { whatsapp: string[]; phones: string[]; emails: string[]; links: string[] };
};

type View = {
  enabled: boolean;
  configured: boolean;
  simulated: boolean;
  account: string | null;
  suggestedHandle: string | null;
  profile: { handle: string; url: string; status: string; confidence: number; evidence: string | null; details: Details | null; lastCheckedAt: string | null } | null;
};

type ReadResult = { handle: string; cached: boolean; added: { whatsapp: number; phones: number; emails: number; website: boolean } };

/** Perfil comercial do Instagram lido pela API oficial da Meta (bio, site, contatos). Nada é raspado do Instagram. */
export function InstagramCard({ companyId }: { companyId: string }) {
  const qc = useQueryClient();
  const { can } = useSession();
  const q = useQuery({ queryKey: ["company-instagram", companyId], queryFn: () => api<View>(`/companies/${companyId}/instagram`) });
  const [handle, setHandle] = useState("");
  const read = useMutation({
    mutationFn: (body: { handle?: string; force?: boolean }) => api<ReadResult>(`/companies/${companyId}/instagram`, { method: "POST", body }),
    onSuccess: (r) => {
      const n = r.added.whatsapp + r.added.phones + r.added.emails;
      toast.success(r.cached ? `@${r.handle}: leitura recente reaproveitada` : `@${r.handle} lido`, { description: r.cached ? "Use “Ler de novo” para consultar outra vez." : `${n} contato(s) novo(s) da bio${r.added.website ? " e o site declarado" : ""}.` });
      setHandle("");
      qc.invalidateQueries({ queryKey: ["company-instagram", companyId] });
      qc.invalidateQueries({ queryKey: ["company", companyId] });
    },
    onError: (e) => toast.error("Não foi possível ler o Instagram", { description: errorMessage(e) }),
  });

  const v = q.data;
  if (!v) return null;
  const canRun = can("enrich:run") && v.enabled && v.configured;
  const d = v.profile?.details ?? null;

  return (
    <SectionCard
      title={
        <span className="flex flex-wrap items-center gap-2">
          Instagram (API oficial)
          {v.simulated && <Badge variant="outline">simulado</Badge>}
        </span>
      }
      description="Bio, site e contatos de perfis comerciais ou de criador, pela API da Meta. Perfil pessoal ou privado não aparece."
    >
      {!v.enabled ? (
        <p className="text-sm text-muted-foreground">
          Leitura desligada nesta conta.{" "}
          {can("settings:manage") && (
            <Link href="/configuracoes" className="underline underline-offset-2">
              Ativar em Configurações › Integrações
            </Link>
          )}
        </p>
      ) : !v.configured ? (
        <p className="text-sm text-muted-foreground">Falta cadastrar o token da Meta e o ID da conta comercial em Configurações › Integrações.</p>
      ) : (
        <div className="grid gap-3 text-sm">
          {v.profile && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <a href={v.profile.url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
                @{v.profile.handle.replace(/^@/, "")} <ExternalLink className="size-3" />
              </a>
              {canRun && (
                <Button size="sm" variant="outline" onClick={() => read.mutate({ force: !!d })} disabled={read.isPending}>
                  {read.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                  {d ? "Ler de novo" : "Ler bio do Instagram"}
                </Button>
              )}
            </div>
          )}
          {d ? (
            <>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
                <div>
                  <dt className="text-muted-foreground">Seguidores</dt>
                  <dd className="num font-medium">{d.followersCount != null ? fmtNumber(d.followersCount) : "Não disponível"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Publicações</dt>
                  <dd className="num font-medium">{d.mediaCount != null ? fmtNumber(d.mediaCount) : "Não disponível"}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-muted-foreground">Site no perfil</dt>
                  <dd className="truncate font-medium">
                    {d.website ? (
                      <a href={d.website} target="_blank" rel="noopener noreferrer nofollow" className="text-primary hover:underline">
                        {d.website}
                      </a>
                    ) : (
                      "Não informado"
                    )}
                  </dd>
                </div>
              </dl>
              {d.biography ? <p className="whitespace-pre-line rounded-md bg-muted/50 px-3 py-2 text-[13px]">{d.biography}</p> : <p className="text-xs text-muted-foreground">Bio vazia.</p>}
              <p className="text-xs text-muted-foreground">
                Na bio: {d.found.whatsapp.length} WhatsApp, {d.found.phones.length} telefone(s), {d.found.emails.length} e-mail(s). Eles entram em Contatos com a origem “Instagram (bio)”.
                {" "}Lido em {fmtDateTime(d.fetchedAt)}.
              </p>
              {v.profile?.evidence && <p className="text-xs text-muted-foreground">{v.profile.evidence}</p>}
            </>
          ) : v.profile ? (
            <p className="text-xs text-muted-foreground">Perfil conhecido, ainda não lido pela API.</p>
          ) : null}
          {!v.profile && canRun && (
            <form
              className="flex flex-wrap gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                read.mutate({ handle: handle || v.suggestedHandle || undefined });
              }}
            >
              <div className="relative max-w-xs flex-1">
                <AtSign className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input value={handle} onChange={(e) => setHandle(e.target.value)} placeholder={v.suggestedHandle ?? "perfil ou link do Instagram"} aria-label="Perfil do Instagram" className="h-8 pl-7 text-sm" />
              </div>
              <Button type="submit" size="sm" disabled={read.isPending || (!handle.trim() && !v.suggestedHandle)}>
                {read.isPending && <Loader2 className="animate-spin" />} Ler perfil
              </Button>
            </form>
          )}
          {!v.profile && !canRun && <p className="text-xs text-muted-foreground">Nenhum perfil do Instagram conhecido para esta empresa.</p>}
        </div>
      )}
    </SectionCard>
  );
}
