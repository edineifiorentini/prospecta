"use client";

import Link from "next/link";
import { toast } from "sonner";
import { ArrowRight, Compass, Rocket, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/session";
import { GUIDE } from "./content";
import { useOnboarding } from "./use-onboarding";

/** Resumo do roteiro no painel: progresso e próximos passos pendentes. Some quando ocultado ou concluído. */
export function ChecklistCard() {
  const { data, update, startTour } = useOnboarding();
  const { can } = useSession();
  if (!data || data.checklistHidden) return null;
  const essential = GUIDE.filter((g) => !g.optional);
  const done = essential.filter((g) => data.checklist[g.key]?.done).length;
  if (done === essential.length) return null;
  const next = GUIDE.filter((g) => !data.checklist[g.key]?.done && !g.optional && (!g.permission || can(g.permission))).slice(0, 3);

  return (
    <section className="card-soft relative mb-5 overflow-hidden p-5" aria-labelledby="checklist-title">
      <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-1/2 bg-[radial-gradient(40rem_16rem_at_100%_0%,oklch(0.92_0.06_155/0.45),transparent_70%)] dark:bg-[radial-gradient(40rem_16rem_at_100%_0%,oklch(0.35_0.08_155/0.3),transparent_70%)]" />
      <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent text-primary">
            <Rocket className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="checklist-title" className="text-sm font-semibold">
              Primeiros passos · {done} de {essential.length}
            </h2>
            <div className="mt-2 h-1.5 max-w-sm overflow-hidden rounded-full bg-muted" aria-hidden>
              <div className="h-full rounded-full bg-primary" style={{ width: `${(done / essential.length) * 100}%` }} />
            </div>
            {next.length > 0 && (
              <ul className="mt-3 flex flex-wrap gap-2">
                {next.map((g) => (
                  <li key={g.key}>
                    <Link href={g.href} className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1 text-xs hover:border-primary/40 hover:text-primary">
                      <g.icon className="size-3.5" /> {g.title}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => startTour(0)}>
            <Compass /> Tour guiado
          </Button>
          <Button size="sm" asChild>
            <Link href="/primeiros-passos">
              Ver roteiro <ArrowRight />
            </Link>
          </Button>
        </div>
      </div>
      <Button
        variant="ghost"
        size="icon-xs"
        className="absolute top-2 right-2"
        aria-label="Ocultar primeiros passos do painel"
        onClick={() => {
          update({ checklistHidden: true });
          toast("Primeiros passos ocultados do painel", { description: "O roteiro continua disponível no menu lateral." });
        }}
      >
        <X />
      </Button>
    </section>
  );
}
