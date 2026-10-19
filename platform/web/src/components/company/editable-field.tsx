"use client";

import { useState } from "react";
import { Check, Loader2, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DataStatusIcon } from "./provenance";
import type { Provenance } from "./types";

/** Campo com edição inline; a edição gera procedência MANUAL e entra no histórico. */
export function EditableField({
  label,
  value,
  provenance,
  onSave,
  canEdit,
  multiline,
  render,
  placeholder = "não informado",
}: {
  label: string;
  value: string | null;
  provenance?: Provenance;
  onSave: (v: string | null) => Promise<unknown>;
  canEdit: boolean;
  multiline?: boolean;
  render?: (v: string) => React.ReactNode;
  placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await onSave(draft.trim() ? draft.trim() : null);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="group grid grid-cols-[8.5rem_1fr] items-start gap-3 py-2 text-sm">
      <dt className="pt-0.5 text-[13px] text-muted-foreground">{label}</dt>
      <dd className="min-w-0">
        {editing ? (
          <div className="flex items-start gap-1.5">
            {multiline ? (
              <Textarea autoFocus rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} className="text-sm" />
            ) : (
              <Input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") save();
                  if (e.key === "Escape") setEditing(false);
                }}
                className="h-8"
              />
            )}
            <Button size="icon-sm" onClick={save} disabled={saving} aria-label="Salvar">
              {saving ? <Loader2 className="animate-spin" /> : <Check />}
            </Button>
            <Button size="icon-sm" variant="ghost" onClick={() => setEditing(false)} aria-label="Cancelar">
              <X />
            </Button>
          </div>
        ) : (
          <div className="flex items-start gap-1.5">
            {value ? (
              <DataStatusIcon status={provenance?.status} source={provenance?.source} sourceUrl={provenance?.sourceUrl} observedAt={provenance?.observedAt} confidence={provenance?.confidence} className="mt-0.5" />
            ) : (
              <DataStatusIcon status="UNAVAILABLE" className="mt-0.5" note="Nenhuma fonte informou este dado até agora." />
            )}
            <span className={value ? "min-w-0 break-words whitespace-pre-line" : "text-muted-foreground/70 italic"}>{value ? (render ? render(value) : value) : placeholder}</span>
            {canEdit && (
              <button
                type="button"
                onClick={() => {
                  setDraft(value ?? "");
                  setEditing(true);
                }}
                className="ml-auto rounded p-0.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100"
                aria-label={`Editar ${label}`}
              >
                <Pencil className="size-3.5" />
              </button>
            )}
          </div>
        )}
      </dd>
    </div>
  );
}
