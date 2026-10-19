import { promises as dns } from "node:dns";
import { env } from "../../config/env.ts";
import { redis } from "../../lib/redis.ts";

export type MxResult = { hasMx: boolean | null; hosts: string[]; checkedAt: string; note: string };

/** Consulta MX do domínio do e-mail. MX existente NÃO garante que a caixa existe ou que a entrega ocorrerá. */
export async function checkMx(email: string): Promise<MxResult> {
  const domain = email.split("@")[1]?.toLowerCase();
  const checkedAt = new Date().toISOString();
  if (!domain) return { hasMx: false, hosts: [], checkedAt, note: "Formato inválido" };
  const cacheKey = `pp:mx:${domain}`;
  const cached = await redis.get(cacheKey);
  if (cached) return JSON.parse(cached) as MxResult;
  let result: MxResult;
  try {
    const records = await Promise.race([
      dns.resolveMx(domain),
      new Promise<never>((_, rej) => setTimeout(() => rej(Object.assign(new Error("timeout"), { code: "ETIMEOUT" })), 6000)),
    ]);
    const hosts = records.sort((a, b) => a.priority - b.priority).map((r) => r.exchange).filter(Boolean);
    result = hosts.length
      ? { hasMx: true, hosts: hosts.slice(0, 5), checkedAt, note: "Domínio aceita e-mails (MX encontrado). Isso não garante a entrega." }
      : { hasMx: false, hosts: [], checkedAt, note: "Domínio sem registro MX." };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    result =
      code === "ENODATA" || code === "ENOTFOUND"
        ? { hasMx: false, hosts: [], checkedAt, note: code === "ENOTFOUND" ? "Domínio inexistente." : "Domínio sem registro MX." }
        : { hasMx: null, hosts: [], checkedAt, note: "Não foi possível consultar o DNS agora." };
  }
  if (result.hasMx !== null) await redis.set(cacheKey, JSON.stringify(result), "EX", 7 * 24 * 3600);
  return result;
}

export type CnpjInfo = {
  cnpj: string;
  razaoSocial: string | null;
  nomeFantasia: string | null;
  situacao: string | null;
  cnae: string | null;
  municipio: string | null;
  uf: string | null;
  abertura: string | null;
  sourceUrl: string;
};

/**
 * Dados públicos do CNPJ (Receita Federal) via BrasilAPI — fonte aberta.
 * Somente dados da pessoa jurídica; quadro societário (dados pessoais) não é armazenado.
 */
export async function lookupCnpj(cnpj: string): Promise<CnpjInfo | null> {
  const digits = cnpj.replace(/\D/g, "");
  const cacheKey = `pp:cnpj:${digits}`;
  const cached = await redis.get(cacheKey);
  if (cached) return cached === "null" ? null : (JSON.parse(cached) as CnpjInfo);
  const url = `https://brasilapi.com.br/api/cnpj/v1/${digits}`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": env.HTTP_USER_AGENT, Accept: "application/json" }, signal: AbortSignal.timeout(12_000) });
    if (res.status === 404) {
      await redis.set(cacheKey, "null", "EX", 24 * 3600);
      return null;
    }
    if (!res.ok) return null;
    const j = (await res.json()) as Record<string, unknown>;
    const info: CnpjInfo = {
      cnpj: digits,
      razaoSocial: (j.razao_social as string) || null,
      nomeFantasia: (j.nome_fantasia as string) || null,
      situacao: (j.descricao_situacao_cadastral as string) || null,
      cnae: [j.cnae_fiscal, j.cnae_fiscal_descricao].filter(Boolean).join(" — ") || null,
      municipio: (j.municipio as string) || null,
      uf: (j.uf as string) || null,
      abertura: (j.data_inicio_atividade as string) || null,
      sourceUrl: url,
    };
    await redis.set(cacheKey, JSON.stringify(info), "EX", 30 * 24 * 3600);
    return info;
  } catch {
    return null;
  }
}

/** Verifica se um link de rede social responde (sem login). Redes que bloqueiam robôs ficam como "não verificado". */
export async function checkSocialLink(url: string): Promise<{ status: number | null; reachable: boolean | null; note: string }> {
  try {
    const { safeFetch } = await import("../../lib/safe-fetch.ts");
    const r = await safeFetch(url, { method: "GET", maxBytes: 150_000, timeoutMs: 10_000, maxRedirects: 4 });
    if (r.status === 404 || r.status === 410) return { status: r.status, reachable: false, note: "Perfil não encontrado (HTTP 404)." };
    if (r.status >= 200 && r.status < 400) {
      if (/login|accounts\/login|checkpoint|authwall/i.test(r.finalUrl)) return { status: r.status, reachable: null, note: "A rede exige login para visualizar; existência não confirmada." };
      return { status: r.status, reachable: true, note: "Link respondeu normalmente." };
    }
    return { status: r.status, reachable: null, note: `A rede respondeu HTTP ${r.status} (pode bloquear acesso automatizado).` };
  } catch {
    return { status: null, reachable: null, note: "Não foi possível verificar o link agora." };
  }
}
