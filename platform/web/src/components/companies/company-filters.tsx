"use client";

import { useQuery } from "@tanstack/react-query";
import { SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { TriStateFilter, type Tri } from "@/components/tri-state";
import { api } from "@/lib/api";
import { ENRICHMENT_LABEL, SOURCE_LABEL } from "@/lib/labels";

export type CompanyFilters = {
  status: "ACTIVE" | "ARCHIVED" | "ALL";
  city?: string;
  category?: string;
  website: Tri;
  phone: Tri;
  email: Tri;
  social: Tri;
  minRating?: number;
  maxRating?: number;
  minReviews?: number;
  maxReviews?: number;
  enrichment?: string;
  source?: string;
  inCrm?: "yes" | "no";
  tagId?: string;
  ownerId?: string;
  minOpportunity?: number;
  maxDataQuality?: number;
};

export const DEFAULT_FILTERS: CompanyFilters = { status: "ACTIVE", website: "any", phone: "any", email: "any", social: "any" };

export function countActive(f: CompanyFilters) {
  return Object.entries(f).filter(([k, v]) => v !== undefined && v !== "" && !(k === "status" && v === "ACTIVE") && v !== "any").length;
}

type Facets = { cities: { value: string; count: number }[]; categories: { value: string; count: number }[]; tags: { id: string; name: string }[]; owners: { id: string; name: string }[] };

const ANY = "__any";

function SelectFilter({ label, value, onChange, options }: { label: string; value?: string; onChange: (v?: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-[13px]">{label}</Label>
      <Select value={value ?? ANY} onValueChange={(v) => onChange(v === ANY ? undefined : v)}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>Todos</SelectItem>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

const num = (v: string) => (v === "" ? undefined : Number(v));

export function CompanyFiltersSheet({ value, onChange }: { value: CompanyFilters; onChange: (f: CompanyFilters) => void }) {
  const facets = useQuery({ queryKey: ["company-facets"], queryFn: () => api<Facets>("/companies/facets"), staleTime: 60_000 });
  const set = (patch: Partial<CompanyFilters>) => onChange({ ...value, ...patch });
  const active = countActive(value);
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm">
          <SlidersHorizontal /> Filtros
          {active > 0 && <span className="rounded-full bg-primary px-1.5 text-[10px] text-primary-foreground">{active}</span>}
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Filtros avançados</SheetTitle>
          <SheetDescription>Combine critérios livremente. Dados ausentes nunca passam em filtros de presença.</SheetDescription>
        </SheetHeader>
        <div className="grid gap-5 px-4 pb-4">
          <div className="grid gap-3">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Canais de contato</p>
            <TriStateFilter id="cf-site" label="Site" value={value.website} onChange={(v) => set({ website: v })} />
            <TriStateFilter id="cf-phone" label="Telefone/WhatsApp" value={value.phone} onChange={(v) => set({ phone: v })} />
            <TriStateFilter id="cf-email" label="E-mail" value={value.email} onChange={(v) => set({ email: v })} />
            <TriStateFilter id="cf-social" label="Redes sociais" value={value.social} onChange={(v) => set({ social: v })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <SelectFilter label="Cidade" value={value.city} onChange={(v) => set({ city: v })} options={(facets.data?.cities ?? []).map((c) => ({ value: c.value, label: `${c.value} (${c.count})` }))} />
            <SelectFilter label="Segmento" value={value.category} onChange={(v) => set({ category: v })} options={(facets.data?.categories ?? []).map((c) => ({ value: c.value, label: `${c.value} (${c.count})` }))} />
          </div>
          <div className="grid gap-2">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Avaliação pública</p>
            <div className="grid grid-cols-4 gap-2">
              <Input aria-label="Nota mínima" placeholder="Nota mín." type="number" step="0.1" min={0} max={5} value={value.minRating ?? ""} onChange={(e) => set({ minRating: num(e.target.value) })} />
              <Input aria-label="Nota máxima" placeholder="Nota máx." type="number" step="0.1" min={0} max={5} value={value.maxRating ?? ""} onChange={(e) => set({ maxRating: num(e.target.value) })} />
              <Input aria-label="Mínimo de avaliações" placeholder="Aval. mín." type="number" min={0} value={value.minReviews ?? ""} onChange={(e) => set({ minReviews: num(e.target.value) })} />
              <Input aria-label="Máximo de avaliações" placeholder="Aval. máx." type="number" min={0} value={value.maxReviews ?? ""} onChange={(e) => set({ maxReviews: num(e.target.value) })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <SelectFilter label="Enriquecimento" value={value.enrichment} onChange={(v) => set({ enrichment: v })} options={Object.entries(ENRICHMENT_LABEL).map(([v, l]) => ({ value: v, label: l }))} />
            <SelectFilter label="Origem" value={value.source} onChange={(v) => set({ source: v })} options={Object.entries(SOURCE_LABEL).map(([v, l]) => ({ value: v, label: l }))} />
            <SelectFilter label="No CRM" value={value.inCrm} onChange={(v) => set({ inCrm: v as "yes" | "no" | undefined })} options={[{ value: "yes", label: "Sim" }, { value: "no", label: "Não" }]} />
            <SelectFilter label="Situação" value={value.status === "ACTIVE" ? undefined : value.status} onChange={(v) => set({ status: (v as CompanyFilters["status"]) ?? "ACTIVE" })} options={[{ value: "ARCHIVED", label: "Arquivadas" }, { value: "ALL", label: "Ativas e arquivadas" }]} />
            <SelectFilter label="Etiqueta" value={value.tagId} onChange={(v) => set({ tagId: v })} options={(facets.data?.tags ?? []).map((t) => ({ value: t.id, label: t.name }))} />
            <SelectFilter label="Responsável" value={value.ownerId} onChange={(v) => set({ ownerId: v })} options={(facets.data?.owners ?? []).map((o) => ({ value: o.id, label: o.name }))} />
          </div>
          <div className="grid gap-2">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Indicadores (após auditoria)</p>
            <div className="grid grid-cols-2 gap-2">
              <Input aria-label="Oportunidade mínima" placeholder="Oportunidade ≥" type="number" min={0} max={100} value={value.minOpportunity ?? ""} onChange={(e) => set({ minOpportunity: num(e.target.value) })} />
              <Input aria-label="Qualidade dos dados máxima" placeholder="Qualidade dos dados ≤" type="number" min={0} max={100} value={value.maxDataQuality ?? ""} onChange={(e) => set({ maxDataQuality: num(e.target.value) })} />
            </div>
          </div>
        </div>
        <SheetFooter>
          <Button variant="ghost" onClick={() => onChange(DEFAULT_FILTERS)}>
            <X /> Limpar filtros
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
