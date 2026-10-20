"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarRange, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { api } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { PERIOD_LABEL, type PeriodKey, useDashboardFilters } from "@/lib/period";

type Facets = { cities: { value: string; count: number }[]; categories: { value: string; count: number }[] };
const ALL = "__all";

/** Período (presets ou intervalo), cidade e segmento — tudo refletido na URL. */
export function FiltersBar() {
  const { filters, update } = useDashboardFilters();
  const facets = useQuery({ queryKey: ["company-facets"], queryFn: () => api<Facets>("/companies/facets"), staleTime: 60_000 });
  const [open, setOpen] = useState(false);
  const [range, setRange] = useState({ from: filters.from ?? "", to: filters.to ?? "" });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={filters.period === "custom" ? "" : filters.period}
        onValueChange={(v) => v && update({ period: v as PeriodKey })}
        aria-label="Período"
      >
        {(Object.keys(PERIOD_LABEL) as (keyof typeof PERIOD_LABEL)[]).map((k) => (
          <ToggleGroupItem key={k} value={k} className="px-2.5 text-xs">
            {PERIOD_LABEL[k]}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant={filters.period === "custom" ? "secondary" : "outline"} size="sm" className="text-xs">
            <CalendarRange />
            {filters.period === "custom" && filters.from && filters.to ? `${fmtDate(`${filters.from}T12:00:00`)} – ${fmtDate(`${filters.to}T12:00:00`)}` : "Personalizado"}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72">
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!range.from || !range.to) return;
              update({ period: "custom", from: range.from, to: range.to });
              setOpen(false);
            }}
          >
            <div className="grid grid-cols-2 gap-2">
              <div className="grid gap-1">
                <Label htmlFor="pf-from" className="text-xs">
                  De
                </Label>
                <Input id="pf-from" type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="pf-to" className="text-xs">
                  Até
                </Label>
                <Input id="pf-to" type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
              </div>
            </div>
            <Button type="submit" size="sm" disabled={!range.from || !range.to}>
              Aplicar
            </Button>
          </form>
        </PopoverContent>
      </Popover>
      <Select value={filters.city ?? ALL} onValueChange={(v) => update({ city: v === ALL ? null : v })}>
        <SelectTrigger size="sm" className="h-8 w-40 text-xs" aria-label="Cidade">
          <SelectValue placeholder="Cidade" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Todas as cidades</SelectItem>
          {facets.data?.cities.map((c) => (
            <SelectItem key={c.value} value={c.value}>
              {c.value} <span className="text-muted-foreground">({c.count})</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={filters.category ?? ALL} onValueChange={(v) => update({ category: v === ALL ? null : v })}>
        <SelectTrigger size="sm" className="h-8 w-44 text-xs" aria-label="Segmento">
          <SelectValue placeholder="Segmento" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Todos os segmentos</SelectItem>
          {facets.data?.categories.map((c) => (
            <SelectItem key={c.value} value={c.value}>
              {c.value} <span className="text-muted-foreground">({c.count})</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {(filters.city || filters.category || filters.period !== "30d") && (
        <Button variant="ghost" size="sm" className="text-xs" onClick={() => update({ period: "30d", city: null, category: null })}>
          <X /> Limpar
        </Button>
      )}
    </div>
  );
}
