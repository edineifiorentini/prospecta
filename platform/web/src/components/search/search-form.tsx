"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Globe2, Loader2, MapPin, Search, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Field } from "@/components/form-field";
import { TriStateFilter } from "@/components/tri-state";
import { api, ApiError, errorMessage } from "@/lib/api";
import type { Source } from "@/lib/types";
import type { MapArea } from "@/components/map/lead-map";
import { cn } from "@/lib/utils";

const tri = z.enum(["any", "with", "without"]);
const optNum = z.union([z.number(), z.nan()]).optional().transform((v) => (v === undefined || Number.isNaN(v) ? undefined : v));

const schema = z
  .object({
    provider: z.enum(["OSM_OVERPASS", "GOOGLE_MAPS_SCRAPER"]),
    keyword: z.string().trim().min(2, "Informe a palavra-chave ou nicho."),
    nameContains: z.string().trim().max(120).optional(),
    country: z.string().trim().min(2),
    state: z.string().trim().max(60).optional(),
    city: z.string().trim().min(2, "Informe a cidade."),
    neighborhood: z.string().trim().max(80).optional(),
    radiusKm: z.number().min(0.5).max(50),
    limit: z.number().int().min(5).max(500),
    lang: z.enum(["pt", "en", "es"]),
    extractEmails: z.boolean(),
    filters: z.object({
      website: tri,
      phone: tri,
      email: tri,
      minRating: optNum,
      maxRating: optNum,
      minReviews: optNum,
      maxReviews: optNum,
    }),
    saveOnlyMatching: z.boolean(),
    acceptRisk: z.boolean(),
  })
  .refine((v) => v.provider !== "GOOGLE_MAPS_SCRAPER" || v.acceptRisk, { path: ["acceptRisk"], message: "Confirme que leu o aviso para usar esta fonte." });

type Values = z.input<typeof schema>;

const LIMITS = [10, 20, 40, 60, 100, 200, 300, 500];

/** O que o mapa da página mostra enquanto o formulário é preenchido. */
export type AreaPreview = { area: MapArea | null; message: string | null };

export function SearchForm({ onAreaChange }: { onAreaChange?: (preview: AreaPreview) => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [showFilters, setShowFilters] = useState(false);
  const sources = useQuery({ queryKey: ["sources"], queryFn: () => api<Source[]>("/sources"), staleTime: 60_000 });

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      provider: "OSM_OVERPASS",
      keyword: "",
      nameContains: "",
      country: "Brasil",
      state: "",
      city: "",
      neighborhood: "",
      radiusKm: 5,
      limit: 60,
      lang: "pt",
      extractEmails: false,
      filters: { website: "any", phone: "any", email: "any" },
      saveOnlyMatching: true,
      acceptRisk: false,
    },
  });
  const provider = useWatch({ control: form.control, name: "provider" });
  const [city, state, neighborhood, country, radiusKm] = useWatch({ control: form.control, name: ["city", "state", "neighborhood", "country", "radiusKm"] });

  // pré-visualização da localização (geocodificação no servidor, com cache)
  // o resultado guarda a chave consultada; ao mudar o local, o anterior deixa de ser exibido
  const geoKey = city && city.trim().length >= 2 ? [city, state, neighborhood, country].join("|") : null;
  const [geoResult, setGeoResult] = useState<{ key: string; geo?: { label: string; latitude: number; longitude: number }; error?: string } | null>(null);
  useEffect(() => {
    if (!geoKey) return;
    const t = setTimeout(() => {
      api<{ label: string; latitude: number; longitude: number }>("/geocode", { method: "POST", body: { city, state: state || undefined, neighborhood: neighborhood || undefined, country } })
        .then((geo) => setGeoResult({ key: geoKey, geo }))
        // como no kit original, a localização só ajuda a centralizar: sem ela a busca segue pelo nome do local
        .catch((e) =>
          setGeoResult({
            key: geoKey,
            error:
              e instanceof ApiError && e.status === 503
                ? "Mapa indisponível agora. A busca segue pelo nome do local (no OpenStreetMap, pelo limite do município)."
                : e instanceof ApiError && e.status === 422
                  ? "Não achei esse lugar no mapa. Confira cidade e estado; a busca seguirá pelo texto informado."
                  : `${errorMessage(e)} A busca seguirá pelo nome do local.`,
          }),
        );
    }, 900);
    return () => clearTimeout(t);
  }, [geoKey, city, state, neighborhood, country]);
  const geo = geoResult?.key === geoKey ? (geoResult.geo ?? null) : null;
  const geoWarning = geoResult?.key === geoKey ? (geoResult.error ?? null) : null;

  // informa o mapa da página: pino no local e círculo do raio, atualizados enquanto a pessoa digita
  useEffect(() => {
    onAreaChange?.({
      area: geo ? { lat: geo.latitude, lon: geo.longitude, label: geo.label, radiusKm } : null,
      message: !geoKey ? "Informe a cidade para ver a área da busca no mapa." : geoWarning ?? (geo ? null : "Localizando no mapa…"),
    });
  }, [onAreaChange, geo, geoKey, geoWarning, radiusKm]);

  const create = useMutation({
    mutationFn: (v: z.output<typeof schema>) => {
      const { acceptRisk: _a, ...body } = v;
      return api<{ id: string }>("/searches", {
        method: "POST",
        body: { ...body, nameContains: body.nameContains || undefined, state: body.state || undefined, neighborhood: body.neighborhood || undefined },
      });
    },
    onSuccess: (res) => {
      toast.success("Busca criada", { description: "Acompanhe o andamento em tempo real." });
      qc.invalidateQueries({ queryKey: ["searches"] });
      router.push(`/buscar/${res.id}`);
    },
    onError: (e) => toast.error("Não foi possível criar a busca", { description: errorMessage(e) }),
  });

  const onSubmit = form.handleSubmit((v) => create.mutate(schema.parse(v)));
  const errors = form.formState.errors;
  const gmaps = sources.data?.find((s) => s.id === "GOOGLE_MAPS_SCRAPER");
  const osm = sources.data?.find((s) => s.id === "OSM_OVERPASS");

  return (
    <form onSubmit={onSubmit} className="grid gap-5" noValidate>
      {/* Fonte */}
      <fieldset className="grid gap-2">
        <legend className="mb-1.5 text-[13px] font-medium">Fonte de dados</legend>
        <Controller
          control={form.control}
          name="provider"
          render={({ field }) => (
            <div className="grid gap-2 sm:grid-cols-2" role="radiogroup">
              {[
                { id: "OSM_OVERPASS" as const, icon: Globe2, title: "OpenStreetMap", desc: "Dados abertos (ODbL). Recomendado.", src: osm },
                { id: "GOOGLE_MAPS_SCRAPER" as const, icon: MapPin, title: "Google Maps (opcional)", desc: "Motor local gosom. Use com moderação.", src: gmaps },
              ].map((opt) => {
                const active = field.value === opt.id;
                const disabled = opt.src ? !opt.src.available : false;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    disabled={disabled}
                    onClick={() => field.onChange(opt.id)}
                    className={cn(
                      "flex items-start gap-3 rounded-xl border bg-card p-3.5 text-left transition-all hover:border-primary/40 disabled:cursor-not-allowed disabled:opacity-50",
                      active && "border-primary/60 ring-3 ring-primary/15",
                    )}
                  >
                    <span className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted", active && "bg-accent text-accent-foreground")}>
                      <opt.icon className="size-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{opt.title}</span>
                      <span className="block text-xs text-muted-foreground">{disabled ? opt.src?.reason : opt.desc}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        />
      </fieldset>

      {provider === "GOOGLE_MAPS_SCRAPER" && (
        <Alert className="border-warning/40 bg-warning-soft/60">
          <ShieldAlert className="text-warning" />
          <AlertTitle>Uso responsável</AlertTitle>
          <AlertDescription className="text-[13px]">
            {gmaps?.warning}
            <label className="mt-2 flex cursor-pointer items-center gap-2 font-medium text-foreground">
              <Controller control={form.control} name="acceptRisk" render={({ field }) => <Checkbox checked={field.value} onCheckedChange={(v) => field.onChange(!!v)} />} />
              Li o aviso e assumo o uso desta fonte
            </label>
            {errors.acceptRisk && <span className="mt-1 block text-xs text-destructive">{errors.acceptRisk.message}</span>}
          </AlertDescription>
        </Alert>
      )}

      {/* O quê */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="keyword" label="Palavra-chave ou nicho" hint="Ex.: dentista, academia, contabilidade" error={errors.keyword?.message}>
          <Input id="keyword" placeholder="dentista" autoFocus {...form.register("keyword")} />
        </Field>
        <Field id="nameContains" label="Nome ou categoria contém" optional hint="Refina pelo nome da empresa">
          <Input id="nameContains" placeholder="ex.: odonto" {...form.register("nameContains")} />
        </Field>
      </div>

      {/* Onde */}
      <div className="grid gap-4 sm:grid-cols-4">
        <Field id="country" label="País">
          <Input id="country" {...form.register("country")} />
        </Field>
        <Field id="state" label="Estado" optional>
          <Input id="state" placeholder="SP" {...form.register("state")} />
        </Field>
        <Field id="city" label="Cidade" error={errors.city?.message}>
          <Input id="city" placeholder="Campinas" {...form.register("city")} />
        </Field>
        <Field id="neighborhood" label="Bairro" optional>
          <Input id="neighborhood" placeholder="Cambuí" {...form.register("neighborhood")} />
        </Field>
      </div>
      <p className={cn("-mt-2 flex items-center gap-1.5 text-xs", geoWarning ? "text-[color-mix(in_oklch,var(--warning),black_30%)] dark:text-warning" : "text-muted-foreground")} aria-live="polite">
        <MapPin className="size-3.5" />
        {geoWarning ?? (geo ? `${geo.label} · ${geo.latitude.toFixed(4)}, ${geo.longitude.toFixed(4)}` : city ? "Localizando…" : "Informe a cidade para localizar a área de busca.")}
      </p>

      <div className="grid gap-5 sm:grid-cols-3">
        <Controller
          control={form.control}
          name="radiusKm"
          render={({ field }) => (
            <div className="grid gap-2.5">
              <div className="flex items-center justify-between text-[13px] font-medium">
                <span id="radius-label">Raio</span>
                <span className="num text-muted-foreground">{field.value} km</span>
              </div>
              <Slider aria-labelledby="radius-label" min={0.5} max={30} step={0.5} value={[field.value]} onValueChange={(v) => field.onChange(v[0])} />
            </div>
          )}
        />
        <Controller
          control={form.control}
          name="limit"
          render={({ field }) => (
            <Field id="limit" label="Quantidade desejada">
              <Select value={String(field.value)} onValueChange={(v) => field.onChange(Number(v))}>
                <SelectTrigger id="limit" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LIMITS.map((l) => (
                    <SelectItem key={l} value={String(l)}>
                      até {l} empresas
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
        />
        <Controller
          control={form.control}
          name="lang"
          render={({ field }) => (
            <Field id="lang" label="Idioma das categorias">
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="lang" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pt">Português</SelectItem>
                  <SelectItem value="en">Inglês</SelectItem>
                  <SelectItem value="es">Espanhol</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          )}
        />
      </div>

      {provider === "GOOGLE_MAPS_SCRAPER" && (
        <label className="flex items-center justify-between gap-4 rounded-xl border bg-card px-4 py-3">
          <span>
            <span className="block text-[13px] font-medium">Buscar e-mails nos sites</span>
            <span className="block text-xs text-muted-foreground">O motor visita o site de cada empresa. Cerca de 2x mais lento.</span>
          </span>
          <Controller control={form.control} name="extractEmails" render={({ field }) => <Switch checked={field.value} onCheckedChange={field.onChange} />} />
        </label>
      )}

      {/* Filtros combináveis */}
      <Collapsible open={showFilters} onOpenChange={setShowFilters} className="rounded-xl border bg-card">
        <CollapsibleTrigger asChild>
          <button type="button" className="flex w-full items-center justify-between px-4 py-3 text-left text-[13px] font-medium">
            Filtros de resultado
            <span className="text-xs font-normal text-muted-foreground">{showFilters ? "ocultar" : "site, telefone, e-mail, avaliação…"}</span>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="grid gap-3 border-t px-4 py-4">
          {(["website", "phone", "email"] as const).map((k) => (
            <Controller
              key={k}
              control={form.control}
              name={`filters.${k}`}
              render={({ field }) => <TriStateFilter id={`f-${k}`} label={{ website: "Site", phone: "Telefone", email: "E-mail" }[k]} value={field.value} onChange={field.onChange} />}
            />
          ))}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field id="minRating" label="Nota mínima" optional>
              <Input id="minRating" type="number" step="0.1" min={0} max={5} {...form.register("filters.minRating", { valueAsNumber: true })} />
            </Field>
            <Field id="maxRating" label="Nota máxima" optional>
              <Input id="maxRating" type="number" step="0.1" min={0} max={5} {...form.register("filters.maxRating", { valueAsNumber: true })} />
            </Field>
            <Field id="minReviews" label="Mín. avaliações" optional>
              <Input id="minReviews" type="number" min={0} {...form.register("filters.minReviews", { valueAsNumber: true })} />
            </Field>
            <Field id="maxReviews" label="Máx. avaliações" optional>
              <Input id="maxReviews" type="number" min={0} {...form.register("filters.maxReviews", { valueAsNumber: true })} />
            </Field>
          </div>
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            Nota e avaliações públicas só existem em algumas fontes (ex.: Google). Empresas sem esse dado não passam em filtros de nota/avaliações.
          </p>
          <label className="flex items-center justify-between gap-4 pt-1">
            <span className="text-[13px]">Salvar como empresas apenas os resultados que atendem aos filtros</span>
            <Controller control={form.control} name="saveOnlyMatching" render={({ field }) => <Switch checked={field.value} onCheckedChange={field.onChange} />} />
          </label>
        </CollapsibleContent>
      </Collapsible>

      <div className="flex items-center justify-end gap-3">
        <span className="text-xs text-muted-foreground">As buscas rodam em fila, uma por vez.</span>
        <Button type="submit" size="lg" disabled={create.isPending}>
          {create.isPending ? <Loader2 className="animate-spin" /> : <Search />}
          Pesquisar
        </Button>
      </div>
    </form>
  );
}
