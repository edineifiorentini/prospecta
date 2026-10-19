"use client";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export type Tri = "any" | "with" | "without";

/** Seletor "Indiferente / Com / Sem" para filtros de presença. */
export function TriStateFilter({ label, value, onChange, id }: { label: string; value: Tri; onChange: (v: Tri) => void; id: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span id={id} className="text-[13px]">
        {label}
      </span>
      <ToggleGroup
        type="single"
        size="sm"
        variant="outline"
        spacing={0}
        value={value}
        onValueChange={(v) => v && onChange(v as Tri)}
        aria-labelledby={id}
      >
        <ToggleGroupItem value="any" className="px-2.5 text-xs">
          Indiferente
        </ToggleGroupItem>
        <ToggleGroupItem value="with" className="px-2.5 text-xs">
          Com
        </ToggleGroupItem>
        <ToggleGroupItem value="without" className="px-2.5 text-xs">
          Sem
        </ToggleGroupItem>
      </ToggleGroup>
    </div>
  );
}
