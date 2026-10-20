"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, Compass, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";
import { TOUR } from "./content";
import { useOnboarding } from "./use-onboarding";

type Rect = { top: number; left: number; width: number; height: number };
const PAD = 6;
const WIDTH = 360;
const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), Math.max(min, max));

function findTarget(targets?: string[]) {
  for (const t of targets ?? []) {
    const el = document.querySelector<HTMLElement>(`[data-tour="${t}"]`);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    if (r.width > 4 && r.height > 4) return el;
  }
  return null;
}

/** Posição do balão: abaixo/acima do alvo, ao lado de alvos altos, centralizado sem alvo; no celular, rodapé. */
function place(rect: Rect | null): CSSProperties {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = Math.min(WIDTH, vw - 32);
  if (vw < 640) return { left: 16, right: 16, bottom: 16 };
  if (!rect) return { left: (vw - w) / 2, top: Math.max(24, vh * 0.26), width: w };
  if (rect.height > vh * 0.55) {
    const top = clamp(rect.top + 16, 16, vh - 320);
    if (vw - (rect.left + rect.width) > w + 40) return { left: rect.left + rect.width + 20, top, width: w };
    if (rect.left > w + 40) return { left: rect.left - w - 20, top, width: w };
    return { left: (vw - w) / 2, bottom: 24, width: w };
  }
  const left = clamp(rect.left, 16, vw - w - 16);
  if (rect.top + rect.height + 260 < vh) return { left, top: rect.top + rect.height + PAD + 10, width: w };
  if (rect.top > 260) return { left, bottom: vh - rect.top + PAD + 10, width: w };
  return { left: (vw - w) / 2, bottom: 24, width: w };
}

/** Tour guiado pelas telas principais. Andamento salvo por usuário; Esc pausa, setas navegam. */
export function GuidedTour() {
  const { data, update } = useOnboarding();
  const { session } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const nextRef = useRef<HTMLButtonElement>(null);
  const active = data?.tour.status === "active";
  const index = clamp(data?.tour.step ?? 0, 0, TOUR.length - 1);
  const step = TOUR[index]!;
  const onRoute = pathname === step.route;
  const key = `${index}:${pathname}`;
  const [found, setFound] = useState<{ key: string; rect: Rect | null } | null>(null);
  const last = index === TOUR.length - 1;

  const go = (i: number) => {
    if (i >= TOUR.length) update({ tour: { status: "completed", step: TOUR.length - 1 } });
    else update({ tour: { status: "active", step: Math.max(0, i) } });
  };
  const pause = () => update({ tour: { status: "dismissed", step: index } });

  // abre a tela do passo atual
  useEffect(() => {
    if (active && !onRoute) router.push(step.route);
  }, [active, onRoute, step.route, router]);

  // localiza o alvo (espera os dados da tela carregarem) e acompanha rolagem e redimensionamento
  useEffect(() => {
    if (!active || !onRoute) return;
    let el: HTMLElement | null = null;
    let tries = 0;
    let raf = 0;
    let timer = 0;
    const measure = () => {
      if (!el || !el.isConnected) return setFound({ key, rect: null });
      const r = el.getBoundingClientRect();
      setFound({ key, rect: { top: r.top, left: r.left, width: r.width, height: r.height } });
    };
    const look = () => {
      // espera o alvo principal carregar (ex.: quadro do CRM) antes de usar o alternativo (cabeçalho da página)
      el = findTarget(tries < 20 ? step.targets?.slice(0, 1) : step.targets);
      if (el) {
        const r = el.getBoundingClientRect();
        if (r.height < window.innerHeight * 0.55 && (r.top < 72 || r.bottom > window.innerHeight - 24)) {
          el.scrollIntoView({ block: "center", behavior: "smooth" });
          timer = window.setTimeout(measure, 320);
        } else measure();
      } else if (!step.targets || ++tries > 30) measure();
      else timer = window.setTimeout(look, 100);
    };
    raf = requestAnimationFrame(look);
    const onChange = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };
    window.addEventListener("resize", onChange);
    window.addEventListener("scroll", onChange, true);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      window.removeEventListener("resize", onChange);
      window.removeEventListener("scroll", onChange, true);
    };
  }, [active, onRoute, key, step.targets]);

  const ready = active && onRoute && found?.key === key;

  // foco no botão principal a cada passo (leitores de tela anunciam o conteúdo do balão)
  useEffect(() => {
    if (ready) nextRef.current?.focus({ preventScroll: true });
  }, [ready, key]);

  // teclado: → avança, ← volta, Esc pausa; setas são ignoradas enquanto a próxima tela carrega
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        update({ tour: { status: "dismissed", step: index } });
      } else if (!ready || e.repeat) return;
      else if (e.key === "ArrowRight") update(index + 1 >= TOUR.length ? { tour: { status: "completed", step: index } } : { tour: { status: "active", step: index + 1 } });
      else if (e.key === "ArrowLeft" && index > 0) update({ tour: { status: "active", step: index - 1 } });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, ready, index, update]);

  if (!active || !session) return null;
  const rect = ready ? found!.rect : null;
  // enquanto mede o próximo alvo na mesma tela, o destaque desliza a partir da posição anterior
  const spot = rect ?? (found && found.key.endsWith(`:${pathname}`) ? found.rect : null);

  return createPortal(
    <>
      {/* bloqueia cliques na página enquanto o tour está aberto */}
      <div className={cn("fixed inset-0 z-[70] transition-colors", !spot && "bg-[var(--tour-dim)]")} aria-hidden />
      {spot && (
        <div
          aria-hidden
          className="pointer-events-none fixed z-[71] rounded-xl ring-2 ring-primary/80 transition-all duration-300 ease-out"
          style={{ top: spot.top - PAD, left: spot.left - PAD, width: spot.width + PAD * 2, height: spot.height + PAD * 2, boxShadow: "0 0 0 9999px var(--tour-dim)" }}
        />
      )}
      {ready && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="tour-title"
          aria-describedby="tour-body"
          className="fixed z-[72] rounded-2xl border bg-popover p-5 text-popover-foreground shadow-[0_24px_60px_-12px_rgb(0_0_0/0.35)] animate-in fade-in-0 zoom-in-95"
          style={place(rect)}
        >
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-xs font-medium text-primary">
              <Compass className="size-3.5" />
              {index === 0 ? "Tour guiado" : `Passo ${index} de ${TOUR.length - 1}`}
            </span>
            <Button variant="ghost" size="icon-xs" onClick={pause} aria-label="Sair do tour">
              <X />
            </Button>
          </div>
          <h2 id="tour-title" className="mt-2 text-base font-semibold tracking-tight">
            {index === 0 && session.user.name ? `${step.title}, ${session.user.name.split(" ")[0]}` : step.title}
          </h2>
          <p id="tour-body" className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            {step.body}
          </p>
          <div className="mt-4 h-1 overflow-hidden rounded-full bg-muted" aria-hidden>
            <div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${(index / (TOUR.length - 1)) * 100}%` }} />
          </div>
          <div className="mt-4 flex items-center justify-between gap-2">
            {index === 0 ? (
              <Button variant="ghost" size="sm" onClick={pause}>
                Agora não
              </Button>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => go(index - 1)}>
                <ArrowLeft /> Voltar
              </Button>
            )}
            <Button ref={nextRef} size="sm" onClick={() => go(index + 1)}>
              {index === 0 ? (
                <>
                  Começar tour <ArrowRight />
                </>
              ) : last ? (
                <>
                  <Check /> Concluir
                </>
              ) : (
                <>
                  Próximo <ArrowRight />
                </>
              )}
            </Button>
          </div>
        </div>
      )}
    </>,
    document.body,
  );
}
