import { stringify } from "csv-stringify/sync";

/**
 * Proteção contra CSV/formula injection: valores que começam com = + - @ (ou tab/CR)
 * são prefixados com apóstrofo para que planilhas não os interpretem como fórmulas.
 */
export function csvSafe(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = Array.isArray(value) ? value.join("; ") : typeof value === "object" ? JSON.stringify(value) : String(value);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

export function toCsv(headers: { key: string; label: string }[], rows: Record<string, unknown>[]): string {
  const data = rows.map((r) => headers.map((h) => csvSafe(r[h.key])));
  // BOM para o Excel reconhecer UTF-8; separador vírgula
  return "﻿" + stringify([headers.map((h) => h.label), ...data]);
}
