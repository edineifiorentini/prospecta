import { formatDistanceToNowStrict, format } from "date-fns";
import { ptBR } from "date-fns/locale";

export const fmtRelative = (d?: string | Date | null) => (d ? formatDistanceToNowStrict(new Date(d), { addSuffix: true, locale: ptBR }) : "—");
export const fmtDate = (d?: string | Date | null) => (d ? format(new Date(d), "dd/MM/yyyy", { locale: ptBR }) : "—");
export const fmtDateTime = (d?: string | Date | null) => (d ? format(new Date(d), "dd/MM/yyyy HH:mm", { locale: ptBR }) : "—");
export const fmtNumber = (n?: number | null) => (n == null ? "—" : new Intl.NumberFormat("pt-BR").format(n));
export const fmtMoney = (cents?: number | null, currency = "BRL") =>
  cents == null ? "—" : new Intl.NumberFormat("pt-BR", { style: "currency", currency, maximumFractionDigits: 0 }).format(cents / 100);
export const fmtRating = (r?: number | null) => (r == null ? "—" : r.toFixed(1).replace(".", ","));
export const fmtDuration = (sec?: number | null) => {
  if (sec == null) return "—";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m ? `${m} min ${s.toString().padStart(2, "0")} s` : `${s} s`;
};

/** Formata telefone E.164 brasileiro para exibição. */
export function fmtPhone(e164?: string | null) {
  if (!e164) return "—";
  const m = e164.match(/^\+55(\d{2})(\d{4,5})(\d{4})$/);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
}

export const hostOf = (url?: string | null) => {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};
