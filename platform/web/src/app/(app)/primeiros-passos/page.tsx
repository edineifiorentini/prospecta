"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2, ChevronDown, Compass, Lock, MapPin, PlayCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/page";
import { StatusBadge } from "@/components/status-badge";
import { GUIDE, type ChecklistKey } from "@/components/onboarding/content";
import { useOnboarding } from "@/components/onboarding/use-onboarding";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";

const COUNT_LABEL: Partial<Record<ChecklistKey, (n: number) => string>> = {
  search: (n) => `${n} busca(s) concluída(s)`,
  review: (n) => `${n} empresa(s) na base`,
  enrich: (n) => `${n} enriquecimento(s)`,
  audit: (n) => `${n} auditoria(s)`,
  crm: (n) => `${n} negociação(ões)`,
  task: (n) => `${n} tarefa(s)`,
  contact: (n) => `${n} contato(s) registrado(s)`,
  report: (n) => `${n} exportação(ões)`,
  team: (n) => `${n} pessoa(s) convidada(s)`,
};

export default function FirstStepsPage() {
  const { data, startTour } = useOnboarding();
  const { can, session } = useSession();
  const [toggled, setToggled] = useState<Partial<Record<ChecklistKey, boolean>>>({});

  const essential = GUIDE.filter((g) => !g.optional);
  const doneEssential = data ? essential.filter((g) => data.checklist[g.key]?.done).length : 0;
  const firstPending = data ? GUIDE.find((g) => !data.checklist[g.key]?.done && (!g.permission || can(g.permission)))?.key : undefined;
  const resume = data?.tour.status === "dismissed" && data.tour.step > 0;

  return (
    <>
      <PageHeader
        title="Primeiros passos"
        description={`Um roteiro para colocar a prospecção para rodar${session ? `, ${session.user.name.split(" ")[0]}` : ""}. Cada passo é marcado sozinho quando a plataforma registra que foi feito.`}
        actions={
          <>
            {resume && (
              <Button variant="outline" size="sm" onClick={() => startTour(data!.tour.step)}>
                <PlayCircle /> Retomar tour
              </Button>
            )}
            <Button size="sm" onClick={() => startTour(0)}>
              <Compass /> {data?.tour.status === "completed" ? "Rever o tour guiado" : "Fazer o tour guiado"}
            </Button>
          </>
        }
      />

      <div className="card-soft mb-6 flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-sm font-semibold">
            {data ? `${doneEssential} de ${essential.length} passos essenciais concluídos` : "Carregando andamento…"}
          </div>
          <div className="text-xs text-muted-foreground">Os passos opcionais aparecem no fim e não contam para o total.</div>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted sm:w-64" role="progressbar" aria-valuemin={0} aria-valuemax={essential.length} aria-valuenow={doneEssential} aria-label="Progresso dos primeiros passos">
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(doneEssential / essential.length) * 100}%` }} />
        </div>
      </div>

      {!data ? (
        <div className="grid gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
      ) : (
        <ol className="grid gap-3" data-tour="guide">
          {GUIDE.map((g, i) => {
            const state = data.checklist[g.key];
            const allowed = !g.permission || can(g.permission);
            const open = toggled[g.key] ?? g.key === firstPending;
            const Icon = g.icon;
            return (
              <li key={g.key} className={cn("card-soft overflow-hidden", g.key === firstPending && "ring-1 ring-primary/40")}>
                <button
                  type="button"
                  className="flex w-full items-start gap-4 p-4 text-left sm:p-5"
                  aria-expanded={open}
                  aria-controls={`guide-${g.key}`}
                  onClick={() => setToggled({ ...toggled, [g.key]: !open })}
                >
                  <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-full", state?.done ? "bg-success-soft text-success" : "bg-accent text-primary")}>
                    {state?.done ? <CheckCircle2 className="size-5" /> : <Icon className="size-4" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-muted-foreground">{i + 1}.</span>
                      <span className="text-sm font-semibold">{g.title}</span>
                      {state?.done ? (
                        <StatusBadge tone="success">concluído</StatusBadge>
                      ) : !allowed ? (
                        <StatusBadge tone="neutral">requer permissão</StatusBadge>
                      ) : g.optional ? (
                        <StatusBadge tone="info">opcional</StatusBadge>
                      ) : g.key === firstPending ? (
                        <StatusBadge tone="warning">próximo passo</StatusBadge>
                      ) : null}
                    </span>
                    <span className="mt-1 block text-sm text-muted-foreground">{g.why}</span>
                    {state?.done && COUNT_LABEL[g.key] && state.count > 0 && <span className="mt-1 block text-xs text-success">{COUNT_LABEL[g.key]!(state.count)}</span>}
                  </span>
                  <ChevronDown className={cn("mt-1 size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden />
                </button>
                {open && (
                  <div id={`guide-${g.key}`} className="border-t bg-muted/30 px-4 py-4 sm:px-5 sm:pl-[4.25rem]">
                    <div className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Como fazer</div>
                    <ul className="mt-2 grid gap-1.5 text-sm">
                      {g.how.map((h) => (
                        <li key={h} className="flex gap-2">
                          <span className="mt-2 size-1 shrink-0 rounded-full bg-primary" aria-hidden />
                          <span>{h}</span>
                        </li>
                      ))}
                    </ul>
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      {allowed ? (
                        <Button size="sm" asChild>
                          <Link href={g.href}>
                            {g.cta} <ArrowRight />
                          </Link>
                        </Button>
                      ) : (
                        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Lock className="size-3.5" /> Seu perfil não permite este passo; peça a um administrador.
                        </span>
                      )}
                      <Button variant="ghost" size="sm" onClick={() => startTour(g.tourStep)}>
                        <MapPin /> Mostrar onde fica
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}
