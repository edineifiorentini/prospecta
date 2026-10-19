"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ListPlus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { api, errorMessage } from "@/lib/api";
import type { CompanyList } from "@/lib/types";

export function AddToListDialog({ companyIds, onDone, trigger }: { companyIds: string[]; onDone?: () => void; trigger?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"existing" | "new">("new");
  const [listId, setListId] = useState<string>("");
  const [name, setName] = useState("");
  const qc = useQueryClient();
  const lists = useQuery({ queryKey: ["lists"], queryFn: () => api<CompanyList[]>("/lists"), enabled: open });

  const save = useMutation({
    mutationFn: async () => {
      if (mode === "new") return api<{ added: number }>("/lists", { method: "POST", body: { name, companyIds } });
      return api<{ added: number }>(`/lists/${listId}/items`, { method: "POST", body: { companyIds } });
    },
    onSuccess: (r) => {
      toast.success(`${r.added} empresa(s) adicionada(s) à lista`);
      qc.invalidateQueries({ queryKey: ["lists"] });
      setOpen(false);
      setName("");
      onDone?.();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const valid = mode === "new" ? name.trim().length > 0 : !!listId;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm" disabled={!companyIds.length}>
            <ListPlus /> Salvar em lista
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Salvar em lista</DialogTitle>
          <DialogDescription>{companyIds.length} empresa(s) selecionada(s).</DialogDescription>
        </DialogHeader>
        <RadioGroup value={mode} onValueChange={(v) => setMode(v as "new" | "existing")} className="gap-3">
          <div className="grid gap-2">
            <Label className="flex items-center gap-2 font-normal">
              <RadioGroupItem value="new" /> Nova lista
            </Label>
            {mode === "new" && <Input autoFocus placeholder="Ex.: Dentistas Campinas — sem site" value={name} onChange={(e) => setName(e.target.value)} />}
          </div>
          <div className="grid gap-2">
            <Label className="flex items-center gap-2 font-normal">
              <RadioGroupItem value="existing" disabled={!lists.data?.length} /> Lista existente
            </Label>
            {mode === "existing" && (
              <div className="max-h-56 overflow-auto rounded-lg border">
                {lists.data?.map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => setListId(l.id)}
                    className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-muted ${listId === l.id ? "bg-accent text-accent-foreground" : ""}`}
                  >
                    <span className="truncate">{l.name}</span>
                    <span className="text-xs text-muted-foreground">{l.count}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </RadioGroup>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button onClick={() => save.mutate()} disabled={!valid || save.isPending}>
            {save.isPending && <Loader2 className="animate-spin" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
