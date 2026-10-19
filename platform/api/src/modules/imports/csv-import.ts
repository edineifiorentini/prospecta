import { parse } from "csv-parse/sync";
import { z } from "zod";
import { fold, safeHttpUrl, splitList } from "../../lib/normalize.ts";
import { mapGmapsRow } from "../sources/gmaps.ts";
import type { DiscoveredCompany } from "../sources/types.ts";

export const IMPORT_FIELDS = [
  "name",
  "legalName",
  "cnpj",
  "category",
  "description",
  "website",
  "phone",
  "email",
  "address",
  "neighborhood",
  "city",
  "state",
  "postalCode",
  "country",
  "rating",
  "reviewCount",
  "latitude",
  "longitude",
  "sourceUrl",
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

const SYNONYMS: Record<ImportField, string[]> = {
  name: ["nome", "name", "title", "empresa", "nome fantasia", "fantasia", "company", "estabelecimento", "razao"],
  legalName: ["razao social", "legal name", "nome empresarial"],
  cnpj: ["cnpj", "cpf cnpj", "documento"],
  category: ["categoria", "category", "segmento", "nicho", "ramo", "atividade", "tipo"],
  description: ["descricao", "description", "descriptions", "sobre"],
  website: ["site", "website", "url", "web", "pagina", "homepage"],
  phone: ["telefone", "phone", "fone", "tel", "celular", "contato", "whatsapp", "telefones"],
  email: ["email", "e mail", "emails", "correio"],
  address: ["endereco", "address", "logradouro", "endereco completo", "rua"],
  neighborhood: ["bairro", "neighborhood", "borough", "distrito"],
  city: ["cidade", "city", "municipio", "localidade"],
  state: ["estado", "state", "uf"],
  postalCode: ["cep", "postal code", "zip", "codigo postal"],
  country: ["pais", "country"],
  rating: ["nota", "rating", "review rating", "avaliacao media", "estrelas"],
  reviewCount: ["avaliacoes", "review count", "reviews", "numero de avaliacoes", "qtd avaliacoes"],
  latitude: ["latitude", "lat"],
  longitude: ["longitude", "lon", "lng", "long"],
  sourceUrl: ["link", "source url", "url da ficha", "google maps", "maps url"],
};

export const mappingSchema = z.partialRecord(z.enum(IMPORT_FIELDS), z.string().max(200).nullable());
export type ColumnMapping = z.infer<typeof mappingSchema>;

/** Detecta o formato e sugere o mapeamento coluna → campo. */
export function detectMapping(headers: string[]): { format: "gosom" | "generic"; mapping: ColumnMapping } {
  const folded = headers.map((h) => ({ raw: h, f: fold(h) }));
  const isGosom = ["title", "place_id", "review_rating"].every((h) => headers.includes(h));
  const mapping: ColumnMapping = {};
  for (const field of IMPORT_FIELDS) {
    const syn = SYNONYMS[field].map(fold);
    const exact = folded.find((h) => syn.includes(h.f));
    const partial = exact ?? folded.find((h) => syn.some((s) => s.length >= 4 && h.f.includes(s)));
    mapping[field] = partial?.raw ?? null;
  }
  // evita a mesma coluna em dois campos (ex.: "razao social" em nome e razão social)
  if (mapping.name && mapping.name === mapping.legalName) {
    const other = folded.find((h) => SYNONYMS.name.map(fold).includes(h.f) && h.raw !== mapping.legalName);
    mapping.name = other?.raw ?? mapping.name;
  }
  return { format: isGosom ? "gosom" : "generic", mapping };
}

export function parseCsv(content: string, maxRows = 5000) {
  const firstLine = content.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows = parse(content, {
    columns: (h: string[]) => h.map((x) => x.trim()),
    skip_empty_lines: true,
    relax_column_count: true,
    relax_quotes: true,
    bom: true,
    delimiter,
    to: maxRows,
    trim: true,
  }) as Record<string, string>[];
  const headers = rows.length ? Object.keys(rows[0]!) : firstLine.split(delimiter).map((h) => h.replace(/^"|"$/g, "").trim());
  return { rows, headers, delimiter };
}

const num = (v?: string | null) => {
  if (!v) return null;
  const n = Number(v.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
};
const dec = (v?: string | null) => {
  if (!v) return null;
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

/** Converte uma linha do CSV no formato interno, sem inventar campos ausentes. */
export function mapCsvRow(row: Record<string, string>, mapping: ColumnMapping, format: "gosom" | "generic"): DiscoveredCompany | null {
  if (format === "gosom") return mapGmapsRow(row);
  const get = (f: ImportField) => {
    const col = mapping[f];
    const v = col ? row[col] : undefined;
    return v && v.trim() ? v.trim() : null;
  };
  const name = get("name") ?? get("legalName");
  if (!name) return null;
  const cnpj = get("cnpj")?.replace(/\D/g, "") ?? null;
  return {
    name,
    legalName: get("legalName"),
    cnpj: cnpj && cnpj.length === 14 ? cnpj : null,
    category: get("category"),
    categories: get("category") ? [get("category")!] : [],
    description: get("description"),
    website: safeHttpUrl(get("website")),
    phones: splitList(get("phone")),
    emails: splitList(get("email")),
    address: get("address"),
    neighborhood: get("neighborhood"),
    city: get("city"),
    state: get("state"),
    postalCode: get("postalCode"),
    country: get("country"),
    rating: dec(get("rating")),
    reviewCount: num(get("reviewCount")),
    latitude: dec(get("latitude")),
    longitude: dec(get("longitude")),
    sourceUrl: safeHttpUrl(get("sourceUrl")),
    raw: row,
  };
}
