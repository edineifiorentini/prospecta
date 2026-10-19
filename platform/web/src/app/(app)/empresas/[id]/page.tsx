"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Archive, ArchiveRestore, ArrowLeft, ExternalLink, FileSearch, Loader2, MoreHorizontal, Sparkles, Star, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState, SectionCard } from "@/components/page";
import { StatusBadge } from "@/components/status-badge";
import { EnrichmentBadge } from "@/components/companies/company-cells";
import { EditableField } from "@/components/company/editable-field";
import { DataStatusLegend } from "@/components/company/provenance";
import { ContactsCard } from "@/components/company/contacts-card";
import { SocialCard, SourcesCard, WebsiteCard } from "@/components/company/presence-cards";
import { Timeline } from "@/components/company/timeline";
import { NotesPanel } from "@/components/company/notes-panel";
import { CrmCard, ScoresCard, TagsCard } from "@/components/company/side-cards";
import { CompanyAuditPanel } from "@/components/audit/company-audit-panel";
import { CompanyConversations } from "@/components/messaging/company-conversations";
import { TaskComposer, TaskList } from "@/components/tasks/task-list";
import type { CompanyDetail } from "@/components/company/types";
import { api, errorMessage } from "@/lib/api";
import { fmtDateTime, fmtMoney, fmtNumber, fmtRating } from "@/lib/format";
import { useSession } from "@/lib/session";

const TABS = ["visao-geral", "atividades", "tarefas", "anotacoes", "negociacoes", "auditoria", "conversas"] as const;

export default function CompanyPage() {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const { can } = useSession();
  const initialTab = (TABS as readonly string[]).includes(params.get("tab") ?? "") ? params.get("tab")! : "visao-geral";
  const [tab, setTab] = useState(initialTab);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteReason, setDeleteReason] = useState("");

  const q = useQuery({
    queryKey: ["company", id],
    queryFn: () => api<CompanyDetail>(`/companies/${id}`),
    refetchInterval: (query) => (["QUEUED", "RUNNING"].includes(query.state.data?.enrichmentStatus ?? "") ? 3000 : false),
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["company", id] });
    qc.invalidateQueries({ queryKey: ["timeline", id] });
  };
  const patch = (body: Record<string, unknown>) =>
    api(`/companies/${id}`, { method: "PATCH", body })
      .then(() => {
        toast.success("Alteração salva");
        refresh();
      })
      .catch((e) => {
        toast.error(errorMessage(e));
        throw e;
      });

  const enrich = useMutation({
    mutationFn: () => api(`/companies/${id}/enrich`, { method: "POST" }),
    onSuccess: () => {
      toast.success("Enriquecimento iniciado", { description: "Visitando o site oficial com respeito ao robots.txt." });
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const audit = useMutation({
    mutationFn: () => api<{ auditId: string }>(`/companies/${id}/audit`, { method: "POST" }),
    onSuccess: () => {
      toast.success("Auditoria digital iniciada");
      setTab("auditoria");
      qc.invalidateQueries({ queryKey: ["company-audits", id] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const archive = useMutation({
    mutationFn: (archived: boolean) => api(`/companies/${id}/archive`, { method: "POST", body: { archived } }),
    onSuccess: () => refresh(),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: () => api(`/companies/${id}`, { method: "DELETE", body: { reason: deleteReason } }),
    onSuccess: () => {
      toast.success("Empresa excluída definitivamente");
      router.replace("/empresas");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  if (!q.data)
    return (
      <div className="grid gap-4">
        <Skeleton className="h-10 w-80" />
        <Skeleton className="h-64" />
      </div>
    );

  const c = q.data;
  const canEdit = can("companies:write");
  const p = c.provenance;
  const enriching = ["QUEUED", "RUNNING"].includes(c.enrichmentStatus);
  const location = [c.neighborhood, c.city, c.state].filter(Boolean).join(", ");

  return (
    <>
      <Button variant="ghost" size="sm" asChild className="-ml-2 mb-2 text-muted-foreground">
        <Link href="/empresas">
          <ArrowLeft /> Empresas
        </Link>
      </Button>

      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{c.name}</h1>
            {c.status === "ARCHIVED" && <StatusBadge>Arquivada</StatusBadge>}
            <EnrichmentBadge status={c.enrichmentStatus} />
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            {c.category && <span>{c.category}</span>}
            {location && <span>{location}</span>}
            {c.rating != null && (
              <span className="inline-flex items-center gap-1">
                <Star className="size-3.5 fill-amber-400 text-amber-400" /> {fmtRating(c.rating)} ({fmtNumber(c.reviewCount)} avaliações públicas)
              </span>
            )}
            {c.sourceUrl && (
              <a href={c.sourceUrl} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 text-primary hover:underline">
                Ficha pública <ExternalLink className="size-3" />
              </a>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {can("enrich:run") && (
            <Button variant="outline" size="sm" onClick={() => enrich.mutate()} disabled={!c.website || enriching || enrich.isPending} title={!c.website ? "Informe o site para enriquecer" : undefined}>
              {enriching || enrich.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />} {enriching ? "Enriquecendo…" : "Enriquecer"}
            </Button>
          )}
          {can("audit:run") && (
            <Button size="sm" onClick={() => audit.mutate()} disabled={audit.isPending}>
              {audit.isPending ? <Loader2 className="animate-spin" /> : <FileSearch />} Auditoria digital
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Mais ações">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {canEdit && (
                <DropdownMenuItem onSelect={() => archive.mutate(c.status !== "ARCHIVED")}>
                  {c.status === "ARCHIVED" ? <ArchiveRestore /> : <Archive />} {c.status === "ARCHIVED" ? "Reativar" : "Arquivar"}
                </DropdownMenuItem>
              )}
              {can("companies:delete") && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setConfirmDelete(true)}>
                    <Trash2 /> Excluir definitivamente
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Tabs value={tab} onValueChange={setTab} className="min-w-0">
          <TabsList className="mb-4 flex-wrap">
            <TabsTrigger value="visao-geral">Visão geral</TabsTrigger>
            <TabsTrigger value="atividades">Atividades</TabsTrigger>
            <TabsTrigger value="tarefas">Tarefas</TabsTrigger>
            <TabsTrigger value="anotacoes">Anotações</TabsTrigger>
            <TabsTrigger value="negociacoes">Negociações{c.deals.length ? ` (${c.deals.length})` : ""}</TabsTrigger>
            <TabsTrigger value="auditoria">Auditoria</TabsTrigger>
            <TabsTrigger value="conversas">Conversas</TabsTrigger>
          </TabsList>

          <TabsContent value="visao-geral" className="grid gap-6">
            <SectionCard title="Dados cadastrais" description="Passe o mouse no ícone para ver origem, data e confiança de cada campo.">
              <dl className="divide-y">
                <EditableField label="Nome comercial" value={c.name} provenance={p.name} canEdit={canEdit} onSave={(v) => patch({ name: v })} />
                <EditableField label="Razão social" value={c.legalName} provenance={p.legalName} canEdit={canEdit} onSave={(v) => patch({ legalName: v })} />
                <EditableField label="CNPJ" value={c.cnpj} provenance={p.cnpj} canEdit={canEdit} onSave={(v) => patch({ cnpj: v })} render={(v) => v.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5")} />
                <EditableField label="Categoria" value={c.category} provenance={p.category} canEdit={canEdit} onSave={(v) => patch({ category: v })} />
                <EditableField label="Descrição" value={c.description} provenance={p.description} canEdit={canEdit} multiline onSave={(v) => patch({ description: v })} />
                <EditableField
                  label="Site"
                  value={c.website}
                  provenance={p.website}
                  canEdit={canEdit}
                  onSave={(v) => patch({ website: v })}
                  render={(v) => (
                    <a href={v} target="_blank" rel="noopener noreferrer nofollow" className="text-primary hover:underline">
                      {v}
                    </a>
                  )}
                />
                <EditableField label="Endereço" value={c.address} provenance={p.address} canEdit={canEdit} onSave={(v) => patch({ address: v })} />
                <EditableField label="Bairro" value={c.neighborhood} provenance={p.neighborhood} canEdit={canEdit} onSave={(v) => patch({ neighborhood: v })} />
                <EditableField label="Cidade" value={c.city} provenance={p.city} canEdit={canEdit} onSave={(v) => patch({ city: v })} />
                <EditableField label="Estado" value={c.state} provenance={p.state} canEdit={canEdit} onSave={(v) => patch({ state: v })} />
                <EditableField label="CEP" value={c.postalCode} provenance={p.postalCode} canEdit={canEdit} onSave={(v) => patch({ postalCode: v })} />
                <EditableField label="País" value={c.country} provenance={p.country} canEdit={canEdit} onSave={(v) => patch({ country: v })} />
                {c.openingHours != null && (
                  <div className="grid grid-cols-[8.5rem_1fr] gap-3 py-2 text-sm">
                    <dt className="text-[13px] text-muted-foreground">Horários</dt>
                    <dd className="text-sm">
                      <OpeningHours value={c.openingHours} />
                    </dd>
                  </div>
                )}
              </dl>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-3">
                <DataStatusLegend />
                <span className="text-[11px] text-muted-foreground">
                  Coletado em {fmtDateTime(c.collectedAt)} · última verificação {fmtDateTime(c.lastVerifiedAt)}
                </span>
              </div>
            </SectionCard>
            <ContactsCard companyId={c.id} contacts={c.contacts} canEdit={canEdit} />
            <SocialCard socials={c.socialProfiles} />
            <WebsiteCard company={c} />
            <SourcesCard company={c} />
          </TabsContent>

          <TabsContent value="atividades">
            <Timeline companyId={c.id} canWrite={can("crm:write")} />
          </TabsContent>

          <TabsContent value="tarefas" className="grid gap-4">
            {can("tasks:write") && <TaskComposer companyId={c.id} dealId={c.deals.find((d) => d.status === "OPEN")?.id} />}
            <TaskList query={{ companyId: c.id, status: "ALL", scope: "all" }} showCompany={false} emptyText="Nenhuma tarefa para esta empresa" />
          </TabsContent>

          <TabsContent value="anotacoes">
            <NotesPanel companyId={c.id} />
          </TabsContent>

          <TabsContent value="negociacoes">
            <SectionCard title="Histórico de negociações" bodyClassName="p-0">
              {!c.deals.length ? (
                <p className="px-5 py-6 text-sm text-muted-foreground">Nenhuma negociação. Use “Adicionar ao CRM” no painel ao lado.</p>
              ) : (
                <ul className="divide-y">
                  {c.deals.map((d) => (
                    <li key={d.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                      <span className="font-medium">{d.title}</span>
                      <StatusBadge tone={d.status === "WON" ? "success" : d.status === "LOST" ? "danger" : "progress"}>{d.stage.name}</StatusBadge>
                      <span className="text-muted-foreground">{fmtMoney(d.valueCents)}</span>
                      {d.lostReason && <span className="text-xs text-muted-foreground">Motivo: {d.lostReason}</span>}
                      <span className="ml-auto text-xs text-muted-foreground">desde {fmtDateTime(d.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>
          </TabsContent>

          <TabsContent value="auditoria">
            <CompanyAuditPanel companyId={c.id} />
          </TabsContent>

          <TabsContent value="conversas">
            <CompanyConversations companyId={c.id} />
          </TabsContent>
        </Tabs>

        <aside className="grid content-start gap-6">
          <CrmCard company={c} canWrite={can("crm:write")} />
          <ScoresCard company={c} />
          <TagsCard company={c} canWrite={canEdit} />
        </aside>
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir “{c.name}” definitivamente?</AlertDialogTitle>
            <AlertDialogDescription>
              Remove a empresa, contatos, negociações, tarefas e conversas vinculadas. Use para atender solicitações de titulares ou a política de retenção. Prefira arquivar quando quiser apenas tirar da lista. A ação fica registrada
              na trilha de auditoria.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea placeholder="Motivo da exclusão (obrigatório)" value={deleteReason} onChange={(e) => setDeleteReason(e.target.value)} aria-label="Motivo da exclusão" />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteReason.trim().length < 3 || remove.isPending}
              onClick={(e) => {
                e.preventDefault();
                remove.mutate();
              }}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

const DAYS: Record<string, string> = { Monday: "Seg", Tuesday: "Ter", Wednesday: "Qua", Thursday: "Qui", Friday: "Sex", Saturday: "Sáb", Sunday: "Dom", "segunda-feira": "Seg", "terça-feira": "Ter", "quarta-feira": "Qua", "quinta-feira": "Qui", "sexta-feira": "Sex", sábado: "Sáb", domingo: "Dom" };

function OpeningHours({ value }: { value: unknown }) {
  if (value && typeof value === "object" && "osm" in (value as Record<string, unknown>)) return <span className="font-mono text-xs">{String((value as Record<string, unknown>).osm)}</span>;
  if (value && typeof value === "object") {
    return (
      <ul className="grid gap-0.5 text-xs">
        {Object.entries(value as Record<string, unknown>).map(([d, h]) => (
          <li key={d}>
            <span className="inline-block w-10 text-muted-foreground">{DAYS[d] ?? d}</span> {Array.isArray(h) ? h.join(", ") : String(h)}
          </li>
        ))}
      </ul>
    );
  }
  return <span>{String(value)}</span>;
}
