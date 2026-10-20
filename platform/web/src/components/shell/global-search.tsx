"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Building2, CheckSquare, KanbanSquare, Search } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { NAV_FOOTER, NAV_MAIN } from "./nav";

type GlobalResult = {
  companies: { id: string; name: string; city: string | null; category: string | null }[];
  deals: { id: string; title: string; companyId: string; stage: string }[];
  tasks: { id: string; title: string; companyId: string | null }[];
};

function useDebounced<T>(value: T, ms = 220) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const query = useDebounced(q.trim());
  const router = useRouter();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const { data, isFetching } = useQuery({
    queryKey: ["global-search", query],
    queryFn: () => api<GlobalResult>("/search/global", { query: { q: query } }),
    enabled: open && query.length >= 2,
    staleTime: 10_000,
  });

  const go = (href: string) => {
    setOpen(false);
    setQ("");
    router.push(href);
  };

  return (
    <>
      <Button
        variant="outline"
        data-tour="global-search"
        onClick={() => setOpen(true)}
        className="h-9 w-full max-w-md justify-start gap-2 rounded-lg border-border/80 bg-card/70 px-3 font-normal text-muted-foreground shadow-none"
        aria-label="Busca global"
      >
        <Search className="size-4" />
        <span className="truncate">Buscar empresas, negociações, tarefas…</span>
        <kbd className="ml-auto hidden rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] sm:inline">Ctrl K</kbd>
      </Button>
      <CommandDialog open={open} onOpenChange={setOpen} title="Busca global" description="Pesquise empresas, negociações, tarefas e páginas">
        <CommandInput placeholder="Digite para buscar…" value={q} onValueChange={setQ} />
        <CommandList>
          <CommandEmpty>{query.length < 2 ? "Digite ao menos 2 caracteres." : isFetching ? "Buscando…" : "Nada encontrado."}</CommandEmpty>
          {!!data?.companies.length && (
            <CommandGroup heading="Empresas">
              {data.companies.map((c) => (
                <CommandItem key={c.id} value={`empresa-${c.id}-${c.name}`} onSelect={() => go(`/empresas/${c.id}`)}>
                  <Building2 />
                  <span className="truncate">{c.name}</span>
                  <span className="ml-auto truncate text-xs text-muted-foreground">{[c.category, c.city].filter(Boolean).join(" · ")}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {!!data?.deals.length && (
            <CommandGroup heading="Negociações">
              {data.deals.map((d) => (
                <CommandItem key={d.id} value={`deal-${d.id}-${d.title}`} onSelect={() => go(`/empresas/${d.companyId}?tab=negociacoes`)}>
                  <KanbanSquare />
                  <span className="truncate">{d.title}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{d.stage}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {!!data?.tasks.length && (
            <CommandGroup heading="Tarefas">
              {data.tasks.map((t) => (
                <CommandItem key={t.id} value={`task-${t.id}-${t.title}`} onSelect={() => go(t.companyId ? `/empresas/${t.companyId}?tab=tarefas` : "/tarefas")}>
                  <CheckSquare />
                  <span className="truncate">{t.title}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          <CommandSeparator />
          <CommandGroup heading="Ir para">
            {[...NAV_MAIN, ...NAV_FOOTER].map((n) => (
              <CommandItem key={n.href} value={`nav-${n.label}`} onSelect={() => go(n.href)}>
                <n.icon />
                {n.label}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  );
}
