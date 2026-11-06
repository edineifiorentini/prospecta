"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ExternalLink, FlaskConical, Landmark, Loader2, Plus, RefreshCw, Settings2, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, PageHeader, SectionCard } from "@/components/page";
import { api, errorMessage } from "@/lib/api";
import { fmtDate, fmtDateTime, fmtNumber, fmtRelative } from "@/lib/format";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";

type Segment = { id: string; name: string; enabled: boolean; keywords: string[] };
type RadarSettings = { segments: Segment[]; ufs: string[]; cityIbgeCodes: string[]; lookbackDays: number; modalities: number[] };
type Item = {
  id: string;
  controlNumber: string;
  buyerName: string | null;
  unitName: string | null;
  uf: string | null;
  city: string | null;
  modality: string | null;
  object: string;
  estimatedValue: number | null;
  status: string | null;
  publishedAt: string | null;
  proposalClosesAt: string | null;
  url: string | null;
  segments: { id: string; name: string; keywords: string[] }[];
};
type View = { enabled: boolean; simulated: boolean; settings: RadarSettings; items: Item[]; total: number; bySegment: Record<string, number>; lastSync: { createdAt: string; ok: boolean; errorCode: string | null } | null };

const UFS = ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"];
const brl = (v: number | null) => (v == null ? "Não informado" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }));

export default function RadarPage() {
  const qc = useQueryClient();
  const { can } = useSession();
  const [segment, setSegment] = useState<string>("");
  const [open, setOpen] = useState(true);
  const [all, setAll] = useState(false);
  const [text, setText] = useState("");
  const [editing, setEditing] = useState(false);
  const qs = new URLSearchParams({ ...(segment ? { segment } : {}), ...(open ? { open: "true" } : {}), ...(all ? { all: "true" } : {}), ...(text.trim() ? { q: text.trim() } : {}) });
  const q = useQuery({ queryKey: ["radar", qs.toString()], queryFn: () => api<View>(`/radar?${qs}`) });
  const sync = useMutation({
    mutationFn: () => api("/radar/sync", { method: "POST" }),
    onSuccess: () => {
      toast.success("Sincronização iniciada: as contratações aparecem aqui em alguns minutos.");
      setTimeout(() => qc.invalidateQueries({ queryKey: ["radar"] }), 15_000);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const v = q.data;

  return (
    <>
      <PageHeader
        title="Radar público"
        description="Contratações publicadas no PNCP que combinam com o que você vende. O órgão público é o comprador: é oportunidade de venda, não um lead."
        actions={
          v?.enabled && (
            <>
              {can("settings:manage") && (
                <Button variant="outline" size="sm" onClick={() => setEditing((x) => !x)}>
                  <Settings2 /> Configurar radar
                </Button>
              )}
              {can("search:run") && (
                <Button size="sm" onClick={() => sync.mutate()} disabled={sync.isPending}>
                  {sync.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />} Sincronizar agora
                </Button>
              )}
            </>
          )
        }
      />
      {!v ? null : !v.enabled ? (
        <EmptyState
          icon={Landmark}
          title="Radar desligado"
          description={
            <>
              Ative o PNCP em{" "}
              <Link href="/configuracoes?tab=integracoes" className="underline underline-offset-2">
                Configurações › Integrações
              </Link>{" "}
              para acompanhar contratações públicas.
            </>
          }
        />
      ) : (
        <div className="grid gap-6">
          {(editing || (!v.settings.ufs.length && !v.settings.cityIbgeCodes.length)) && can("settings:manage") && <RadarSettingsEditor settings={v.settings} onSaved={() => setEditing(false)} />}
          <SectionCard bodyClassName="grid gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant={segment ? "outline" : "default"} onClick={() => setSegment("")}>
                Todos
              </Button>
              {v.settings.segments
                .filter((s) => s.enabled)
                .map((s) => (
                  <Button key={s.id} size="sm" variant={segment === s.id ? "default" : "outline"} onClick={() => setSegment(s.id)}>
                    {s.name} <span className="ml-1 text-xs opacity-70">{fmtNumber(v.bySegment[s.id] ?? 0)}</span>
                  </Button>
                ))}
            </div>
            <div className="flex flex-wrap items-center gap-4 text-sm">
              <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Buscar no objeto" className="h-8 max-w-xs" />
              <label className="flex items-center gap-2">
                <Switch checked={open} onCheckedChange={setOpen} /> Só com propostas abertas
              </label>
              <label className="flex items-center gap-2">
                <Switch checked={all} onCheckedChange={setAll} /> Incluir as que não combinam com nenhum segmento
              </label>
            </div>
            <p className="text-xs text-muted-foreground">
              {v.settings.ufs.length ? `UFs: ${v.settings.ufs.join(", ")}` : v.settings.cityIbgeCodes.length ? `${v.settings.cityIbgeCodes.length} município(s)` : "Nenhuma UF configurada"} · última sincronização:{" "}
              {v.lastSync ? `${fmtRelative(v.lastSync.createdAt)}${v.lastSync.ok ? "" : ` (falhou: ${v.lastSync.errorCode})`}` : "nunca"}
              {v.simulated && (
                <span className="ml-2 inline-flex items-center gap-1">
                  <FlaskConical className="size-3" /> modo simulado
                </span>
              )}
            </p>
          </SectionCard>

          {!v.items.length ? (
            <EmptyState icon={Landmark} title="Nenhuma contratação encontrada" description="Sincronize o radar ou ajuste os segmentos e as UFs. Só aparecem contratações já trazidas do PNCP." />
          ) : (
            <ul className="grid gap-3">
              {v.items.map((i) => (
                <li key={i.id} className="card-soft px-5 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    {i.segments.map((s) => (
                      <Badge key={s.id} variant="secondary" title={`Palavras: ${s.keywords.join(", ")}`}>
                        {s.name}
                      </Badge>
                    ))}
                    {i.modality && <Badge variant="outline">{i.modality}</Badge>}
                    {i.proposalClosesAt && <span className={cn("text-xs", new Date(i.proposalClosesAt) < new Date() ? "text-muted-foreground" : "font-medium")}>propostas até {fmtDateTime(i.proposalClosesAt)}</span>}
                  </div>
                  <p className="mt-2 text-sm text-pretty">{i.object}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Comprador: {i.buyerName ?? "não informado"}
                    {i.city ? ` · ${i.city}/${i.uf}` : i.uf ? ` · ${i.uf}` : ""} · valor estimado {brl(i.estimatedValue)} · publicada em {fmtDate(i.publishedAt)}
                    {i.status ? ` · ${i.status}` : ""}
                  </p>
                  {i.url && (
                    <a href={i.url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs underline underline-offset-2">
                      Ver no PNCP <ExternalLink className="size-3" />
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
          {v.total > v.items.length && <p className="text-center text-xs text-muted-foreground">Mostrando {v.items.length} de {fmtNumber(v.total)}. Refine os filtros para ver as demais.</p>}
        </div>
      )}
    </>
  );
}

function RadarSettingsEditor({ settings, onSaved }: { settings: RadarSettings; onSaved: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<RadarSettings>(settings);
  const [cities, setCities] = useState(settings.cityIbgeCodes.join(", "));
  const meta = useQuery({ queryKey: ["radar-settings"], queryFn: () => api<{ modalities: { id: number; name: string }[] }>("/radar/settings") });
  const save = useMutation({
    mutationFn: () => api("/radar/settings", { method: "PUT", body: { ...form, cityIbgeCodes: cities.split(/[\s,;]+/).filter(Boolean) } }),
    onSuccess: () => {
      toast.success("Radar salvo");
      qc.invalidateQueries({ queryKey: ["radar"] });
      onSaved();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const seg = (i: number, patch: Partial<Segment>) => setForm((f) => ({ ...f, segments: f.segments.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));
  return (
    <SectionCard title="Configurar radar" description="Onde procurar e o que conta como oportunidade. As palavras são procuradas no objeto da contratação (sem acento, palavra inteira).">
      <div className="grid gap-5 text-sm">
        <div className="grid gap-1.5">
          <Label className="text-xs">UFs sincronizadas</Label>
          <div className="flex flex-wrap gap-x-3 gap-y-1.5">
            {UFS.map((uf) => (
              <label key={uf} className="flex items-center gap-1 text-xs">
                <Checkbox checked={form.ufs.includes(uf)} onCheckedChange={(x) => setForm((f) => ({ ...f, ufs: x ? [...f.ufs, uf] : f.ufs.filter((u) => u !== uf) }))} />
                {uf}
              </label>
            ))}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label className="text-xs">Só estes municípios (códigos IBGE de 7 dígitos, opcional)</Label>
            <Input value={cities} onChange={(e) => setCities(e.target.value)} placeholder="4128104, 4115200" />
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs">Publicações dos últimos (dias)</Label>
            <Input type="number" min={1} max={60} value={form.lookbackDays} onChange={(e) => setForm((f) => ({ ...f, lookbackDays: Number(e.target.value) }))} className="max-w-32" />
          </div>
        </div>
        <div className="grid gap-1.5">
          <Label className="text-xs">Modalidades</Label>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {(meta.data?.modalities ?? []).map((m) => (
              <label key={m.id} className="flex items-center gap-1.5 text-xs">
                <Checkbox checked={form.modalities.includes(m.id)} onCheckedChange={(x) => setForm((f) => ({ ...f, modalities: x ? [...f.modalities, m.id] : f.modalities.filter((y) => y !== m.id) }))} />
                {m.name}
              </label>
            ))}
          </div>
        </div>
        <div className="grid gap-2">
          <Label className="text-xs">Segmentos de interesse</Label>
          {form.segments.map((s, i) => (
            <div key={s.id} className="grid gap-2 rounded-md border px-3 py-2 sm:grid-cols-[200px_minmax(0,1fr)_auto]">
              <div className="flex items-center gap-2">
                <Switch checked={s.enabled} onCheckedChange={(x) => seg(i, { enabled: x })} aria-label={`Ativar ${s.name}`} />
                <Input value={s.name} onChange={(e) => seg(i, { name: e.target.value })} className="h-8" />
              </div>
              <Textarea value={s.keywords.join(", ")} onChange={(e) => seg(i, { keywords: e.target.value.split(",").map((k) => k.trim()).filter(Boolean) })} rows={2} className="min-h-0 text-xs" />
              <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setForm((f) => ({ ...f, segments: f.segments.filter((_, j) => j !== i) }))}>
                <Trash2 />
              </Button>
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            className="w-fit"
            disabled={form.segments.length >= 20}
            onClick={() => setForm((f) => ({ ...f, segments: [...f.segments, { id: `segmento-${Date.now().toString(36)}`, name: "Novo segmento", enabled: true, keywords: ["palavra"] }] }))}
          >
            <Plus /> Segmento
          </Button>
        </div>
        <div className="flex justify-end">
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending && <Loader2 className="animate-spin" />} Salvar radar
          </Button>
        </div>
      </div>
    </SectionCard>
  );
}
