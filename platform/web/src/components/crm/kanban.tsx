"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CalendarClock, GripVertical } from "lucide-react";
import { ScorePill } from "@/components/score-pill";
import { fmtDate, fmtMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { STAGE_DOT } from "@/lib/labels";
import { useNow, useSyncedState } from "@/lib/hooks";

export type KanbanStage = { id: string; name: string; color: string; kind: "OPEN" | "WON" | "LOST"; position: number };
export type KanbanDeal = {
  id: string;
  title: string;
  valueCents: number | null;
  status: string;
  position: number;
  stageId: string;
  owner: { id: string; name: string } | null;
  company: { id: string; name: string; category: string | null; city: string | null; scores: { kind: string; score: number | null }[]; tags: { tag: { id: string; name: string } }[] };
  tasks: { id: string; title: string; dueAt: string | null }[];
};


function DealCard({ deal, overlay }: { deal: KanbanDeal; overlay?: boolean }) {
  const opp = deal.company.scores.find((s) => s.kind === "OPPORTUNITY");
  const next = deal.tasks[0];
  const now = useNow();
  const overdue = next?.dueAt && new Date(next.dueAt).getTime() < now;
  return (
    <div className={cn("rounded-lg border bg-card p-3 text-left shadow-[0_1px_2px_rgb(0_0_0/0.04)]", overlay && "rotate-1 shadow-[var(--shadow-float)]")}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <Link href={`/empresas/${deal.company.id}`} className="line-clamp-2 text-sm font-medium hover:underline" onPointerDown={(e) => e.stopPropagation()}>
            {deal.company.name}
          </Link>
          <div className="mt-0.5 truncate text-xs text-muted-foreground">{[deal.company.category, deal.company.city].filter(Boolean).join(" · ") || "—"}</div>
        </div>
        {opp?.score != null && <ScorePill score={opp.score} label="Oportunidade comercial" />}
      </div>
      <div className="mt-2.5 flex items-center justify-between gap-2 text-xs">
        <span className="num font-medium">{deal.valueCents != null ? fmtMoney(deal.valueCents) : <span className="text-muted-foreground">sem valor</span>}</span>
        {deal.owner && <span className="truncate text-muted-foreground">{deal.owner.name.split(" ")[0]}</span>}
      </div>
      {next && (
        <div className={cn("mt-2 flex items-center gap-1 truncate text-[11px]", overdue ? "text-destructive" : "text-muted-foreground")}>
          <CalendarClock className="size-3 shrink-0" /> {next.title} {next.dueAt && `· ${fmtDate(next.dueAt)}`}
        </div>
      )}
    </div>
  );
}

function SortableDeal({ deal }: { deal: KanbanDeal }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: deal.id, data: { type: "deal", stageId: deal.stageId } });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn("group relative", isDragging && "opacity-40")} {...attributes} {...listeners}>
      <GripVertical className="absolute top-3 -left-0.5 size-3.5 text-muted-foreground/40 opacity-0 group-hover:opacity-100" aria-hidden />
      <DealCard deal={deal} />
    </div>
  );
}

function Column({ stage, deals }: { stage: KanbanStage; deals: KanbanDeal[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: `stage:${stage.id}`, data: { type: "stage", stageId: stage.id } });
  const total = deals.reduce((s, d) => s + (d.valueCents ?? 0), 0);
  return (
    <section aria-label={`Etapa ${stage.name}`} className="flex w-72 shrink-0 flex-col rounded-xl bg-muted/50">
      <header className="flex items-center gap-2 px-3 pt-3 pb-2">
        <span className={cn("size-2 rounded-full", STAGE_DOT[stage.color] ?? "bg-slate-400")} />
        <h3 className="truncate text-[13px] font-semibold">{stage.name}</h3>
        <span className="num rounded-full bg-background px-1.5 text-[11px] text-muted-foreground">{deals.length}</span>
        {total > 0 && <span className="num ml-auto text-[11px] text-muted-foreground">{fmtMoney(total)}</span>}
      </header>
      <div ref={setNodeRef} className={cn("flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2 transition-colors", isOver && "rounded-lg bg-accent/60")}>
        <SortableContext items={deals.map((d) => d.id)} strategy={verticalListSortingStrategy}>
          {deals.map((d) => (
            <SortableDeal key={d.id} deal={d} />
          ))}
        </SortableContext>
        {!deals.length && <p className="px-2 py-6 text-center text-xs text-muted-foreground">Arraste negociações para cá</p>}
      </div>
    </section>
  );
}

/** Kanban com arrastar e soltar (mouse, toque e teclado). Persiste etapa e posição ao soltar. */
export function KanbanBoard({ stages, deals, onMove }: { stages: KanbanStage[]; deals: KanbanDeal[]; onMove: (dealId: string, stageId: string, position: number, toStage: KanbanStage) => void }) {
  const [activeId, setActiveId] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const g: Record<string, KanbanDeal[]> = {};
    for (const s of stages) g[s.id] = [];
    for (const d of deals) (g[d.stageId] ??= []).push(d);
    for (const k of Object.keys(g)) g[k]!.sort((a, b) => a.position - b.position);
    return g;
  }, [stages, deals]);
  // estado otimista durante o arraste; volta a refletir o servidor quando os dados mudam
  const [items, setItems] = useSyncedState(grouped, (g) => g);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const findStage = (id: string) => (id.startsWith("stage:") ? id.slice(6) : Object.keys(items).find((k) => items[k]!.some((d) => d.id === id)));
  const active = activeId ? Object.values(items).flat().find((d) => d.id === activeId) : null;

  const onDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id));
  const onDragOver = (e: DragOverEvent) => {
    const { active, over } = e;
    if (!over) return;
    const from = findStage(String(active.id));
    const to = findStage(String(over.id));
    if (!from || !to || from === to) return;
    setItems((prev) => {
      const moving = prev[from]!.find((d) => d.id === active.id)!;
      const target = [...prev[to]!];
      const overIndex = target.findIndex((d) => d.id === over.id);
      target.splice(overIndex >= 0 ? overIndex : target.length, 0, { ...moving, stageId: to });
      return { ...prev, [from]: prev[from]!.filter((d) => d.id !== active.id), [to]: target };
    });
  };
  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = e;
    if (!over) return setItems(grouped);
    const stageId = findStage(String(active.id));
    if (!stageId) return;
    let list = [...items[stageId]!];
    const oldIndex = list.findIndex((d) => d.id === active.id);
    const overIndex = String(over.id).startsWith("stage:") ? list.length - 1 : list.findIndex((d) => d.id === over.id);
    if (oldIndex !== overIndex && overIndex >= 0) {
      const [m] = list.splice(oldIndex, 1);
      list.splice(overIndex, 0, m!);
      setItems((prev) => ({ ...prev, [stageId]: list }));
    }
    list = list.length ? list : [];
    const idx = list.findIndex((d) => d.id === active.id);
    const before = list[idx - 1]?.position;
    const after = list[idx + 1]?.position;
    const position = before !== undefined && after !== undefined ? (before + after) / 2 : before !== undefined ? before + 1 : after !== undefined ? after - 1 : 0;
    const original = deals.find((d) => d.id === active.id)!;
    if (original.stageId === stageId && Math.abs(original.position - position) < 1e-9) return;
    onMove(String(active.id), stageId, position, stages.find((s) => s.id === stageId)!);
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd} onDragCancel={() => setItems(grouped)}>
      <div className="flex h-[calc(100dvh-13rem)] min-h-[420px] gap-3 overflow-x-auto pb-2">
        {stages.map((s) => (
          <Column key={s.id} stage={s} deals={items[s.id] ?? []} />
        ))}
      </div>
      <DragOverlay>{active ? <DealCard deal={active} overlay /> : null}</DragOverlay>
    </DndContext>
  );
}
