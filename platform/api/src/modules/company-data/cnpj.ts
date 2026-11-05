/** CNPJ: só dígitos, validação dos dígitos verificadores e formatação. */

export const cnpjDigits = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "");

function checkDigit(base: string) {
  const weights = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const sum = [...base].reduce((s, d, i) => s + Number(d) * weights[i]!, 0);
  const r = sum % 11;
  return r < 2 ? 0 : 11 - r;
}

/** Completa uma base de 12 dígitos com os dois verificadores. */
export function withCheckDigits(base12: string) {
  const first = checkDigit(base12);
  return `${base12}${first}${checkDigit(`${base12}${first}`)}`;
}

export function isValidCnpj(v: string | null | undefined): boolean {
  const d = cnpjDigits(v);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  return withCheckDigits(d.slice(0, 12)) === d;
}

export function formatCnpj(v: string | null | undefined): string | null {
  const d = cnpjDigits(v);
  return d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : null;
}
