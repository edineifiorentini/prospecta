"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Field } from "@/components/form-field";
import { SectionCard } from "@/components/page";
import { api, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useSyncedState } from "@/lib/hooks";

export type OrgSettings = {
  messaging: { maxOutboundPerHour: number; maxOutboundPerDay: number; requireApproval: boolean; optOutKeywords: string[] };
  retention: { rawDataDays: number; archivedCompanyDays: number; webhookEventDays: number; auditLogDays: number };
  scoring: Record<string, Record<string, number>>;
  discovery: { googleMapsEnabled: boolean; defaultCountry: string };
};
export type Org = { id: string; name: string; slug: string; settings: OrgSettings };

export function useOrg() {
  return useQuery({ queryKey: ["org"], queryFn: () => api<Org>("/org") });
}

export function OrganizationSettings() {
  const qc = useQueryClient();
  const { can } = useSession();
  const org = useOrg();
  const [draft, setDraft] = useSyncedState(org.data, (d): Org | null => d ?? null);
  const save = useMutation({
    mutationFn: () => api("/org", { method: "PATCH", body: { name: draft!.name, settings: { discovery: draft!.settings.discovery, retention: draft!.settings.retention } } }),
    onSuccess: () => {
      toast.success("Configurações salvas");
      qc.invalidateQueries({ queryKey: ["org"] });
      qc.invalidateQueries({ queryKey: ["sources"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (!draft) return null;
  const editable = can("settings:manage");
  const setRet = (k: keyof OrgSettings["retention"], v: string) => setDraft({ ...draft, settings: { ...draft.settings, retention: { ...draft.settings.retention, [k]: Number(v) } } });
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <SectionCard title="Organização">
        <Field id="org-name" label="Nome">
          <Input id="org-name" value={draft.name} disabled={!editable} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </Field>
        <label className="mt-4 flex items-start justify-between gap-4">
          <span>
            <span className="block text-[13px] font-medium">Permitir o adaptador do Google Maps</span>
            <span className="block text-xs text-muted-foreground">A raspagem do Google Maps contraria os Termos do Google. Desative para usar só fontes abertas e CSV.</span>
          </span>
          <Switch
            checked={draft.settings.discovery.googleMapsEnabled}
            disabled={!editable}
            onCheckedChange={(v) => setDraft({ ...draft, settings: { ...draft.settings, discovery: { ...draft.settings.discovery, googleMapsEnabled: v } } })}
          />
        </label>
      </SectionCard>
      <SectionCard title="Retenção de dados (LGPD)" description="Limpeza automática diária às 03:00.">
        <div className="grid grid-cols-2 gap-3">
          <Field id="r1" label="Registros brutos das fontes (dias)">
            <Input id="r1" type="number" min={7} value={draft.settings.retention.rawDataDays} disabled={!editable} onChange={(e) => setRet("rawDataDays", e.target.value)} />
          </Field>
          <Field id="r2" label="Excluir empresas arquivadas após (dias)">
            <Input id="r2" type="number" min={30} value={draft.settings.retention.archivedCompanyDays} disabled={!editable} onChange={(e) => setRet("archivedCompanyDays", e.target.value)} />
          </Field>
          <Field id="r3" label="Eventos de webhook (dias)">
            <Input id="r3" type="number" min={7} value={draft.settings.retention.webhookEventDays} disabled={!editable} onChange={(e) => setRet("webhookEventDays", e.target.value)} />
          </Field>
          <Field id="r4" label="Trilha de auditoria (dias)">
            <Input id="r4" type="number" min={180} value={draft.settings.retention.auditLogDays} disabled={!editable} onChange={(e) => setRet("auditLogDays", e.target.value)} />
          </Field>
        </div>
      </SectionCard>
      {editable && (
        <div className="flex justify-end lg:col-span-2">
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending && <Loader2 className="animate-spin" />} Salvar alterações
          </Button>
        </div>
      )}
    </div>
  );
}
