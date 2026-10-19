"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileUp, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Field } from "@/components/form-field";
import { api, errorMessage } from "@/lib/api";

const FIELD_LABELS: Record<string, string> = {
  name: "Nome comercial",
  legalName: "Razão social",
  cnpj: "CNPJ",
  category: "Categoria",
  description: "Descrição",
  website: "Site",
  phone: "Telefone",
  email: "E-mail",
  address: "Endereço",
  neighborhood: "Bairro",
  city: "Cidade",
  state: "Estado",
  postalCode: "CEP",
  country: "País",
  rating: "Nota pública",
  reviewCount: "Nº de avaliações",
  latitude: "Latitude",
  longitude: "Longitude",
  sourceUrl: "Link da ficha",
};

type Preview = {
  token: string;
  fileName: string;
  headers: string[];
  format: "gosom" | "generic";
  mapping: Record<string, string | null>;
  totalRows: number;
  truncated: boolean;
  sample: ({ name: string; category: string | null; phones: string[]; emails: string[]; website: string | null; city: string | null; state: string | null } | null)[];
};

export function CsvImport() {
  const router = useRouter();
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [onlyWithPhone, setOnlyWithPhone] = useState(false);
  const [note, setNote] = useState("");

  const upload = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      return api<Preview>("/imports/csv/preview", { method: "POST", body: fd });
    },
    onSuccess: (p) => {
      setPreview(p);
      setMapping(p.mapping);
    },
    onError: (e) => toast.error("Não foi possível ler o arquivo", { description: errorMessage(e) }),
  });

  const commit = useMutation({
    mutationFn: () =>
      api<{ id: string }>("/imports/csv/commit", {
        method: "POST",
        body: {
          token: preview!.token,
          mapping,
          filters: { website: "any", phone: onlyWithPhone ? "with" : "any", email: "any" },
          saveOnlyMatching: onlyWithPhone,
          legalBasisNote: note || undefined,
        },
      }),
    onSuccess: (r) => {
      toast.success("Importação iniciada");
      qc.invalidateQueries({ queryKey: ["searches"] });
      router.push(`/buscar/${r.id}`);
    },
    onError: (e) => toast.error("Falha ao importar", { description: errorMessage(e) }),
  });

  return (
    <div className="grid gap-5">
      <div
        className="flex flex-col items-center justify-center rounded-xl border border-dashed bg-card/60 px-6 py-10 text-center"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files?.[0];
          if (f) upload.mutate(f);
        }}
      >
        <span className="flex size-11 items-center justify-center rounded-full bg-accent text-accent-foreground">
          <FileUp className="size-5" />
        </span>
        <p className="mt-3 text-sm font-medium">Arraste um arquivo CSV ou escolha no computador</p>
        <p className="mt-1 max-w-md text-xs text-muted-foreground">
          Aceita planilhas próprias (colunas como nome, telefone, e-mail, site, cidade) e o CSV completo do Google Maps Scraper. Até 5.000 linhas e 15 MB.
        </p>
        <input ref={inputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && upload.mutate(e.target.files[0])} />
        <Button variant="outline" className="mt-4" onClick={() => inputRef.current?.click()} disabled={upload.isPending}>
          {upload.isPending ? <Loader2 className="animate-spin" /> : <Upload />}
          Selecionar arquivo
        </Button>
      </div>

      {preview && (
        <div className="grid gap-5">
          <Alert>
            <AlertDescription className="text-[13px]">
              <b>{preview.fileName}</b>: {preview.totalRows.toLocaleString("pt-BR")} linhas
              {preview.truncated && " (limitado às primeiras 5.000)"} · formato {preview.format === "gosom" ? "Google Maps Scraper (mapeamento automático)" : "genérico"}.
            </AlertDescription>
          </Alert>

          {preview.format === "generic" && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {Object.keys(FIELD_LABELS).map((field) => (
                <Field key={field} id={`map-${field}`} label={FIELD_LABELS[field]}>
                  <Select value={mapping[field] ?? "__none"} onValueChange={(v) => setMapping((m) => ({ ...m, [field]: v === "__none" ? null : v }))}>
                    <SelectTrigger id={`map-${field}`} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">— não importar —</SelectItem>
                      {preview.headers.map((h) => (
                        <SelectItem key={h} value={h}>
                          {h}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              ))}
            </div>
          )}

          <div className="card-soft overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead>Telefones</TableHead>
                  <TableHead>E-mails</TableHead>
                  <TableHead>Site</TableHead>
                  <TableHead>Cidade</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.sample.map((r, i) => (
                  <TableRow key={i}>
                    {r ? (
                      <>
                        <TableCell className="font-medium">{r.name}</TableCell>
                        <TableCell>{r.category ?? "—"}</TableCell>
                        <TableCell>{r.phones.join(", ") || "—"}</TableCell>
                        <TableCell>{r.emails.join(", ") || "—"}</TableCell>
                        <TableCell className="max-w-48 truncate">{r.website ?? "—"}</TableCell>
                        <TableCell>{[r.city, r.state].filter(Boolean).join("/") || "—"}</TableCell>
                      </>
                    ) : (
                      <TableCell colSpan={6} className="text-muted-foreground">
                        Linha sem nome — será ignorada
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="border-t px-4 py-2 text-xs text-muted-foreground">Prévia das primeiras linhas com o mapeamento atual (a amostra reflete o mapeamento sugerido).</p>
          </div>

          <label className="flex items-center justify-between gap-4 rounded-xl border bg-card px-4 py-3">
            <span className="text-[13px]">Importar somente linhas com telefone</span>
            <Switch checked={onlyWithPhone} onCheckedChange={setOnlyWithPhone} />
          </label>
          <Field id="note" label="Origem e base legal dos dados" optional hint="Ex.: lista de clientes própria; evento X com consentimento. Fica registrado na trilha de auditoria.">
            <Textarea id="note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setPreview(null)}>
              Descartar
            </Button>
            <Button onClick={() => commit.mutate()} disabled={commit.isPending}>
              {commit.isPending && <Loader2 className="animate-spin" />}
              Importar {preview.totalRows.toLocaleString("pt-BR")} linhas
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
