import { lookup as dnsLookup } from "node:dns";
import { isIP } from "node:net";
import { Agent, fetch as undiciFetch, type Dispatcher } from "undici";
import { env } from "../config/env.ts";

/**
 * Cliente HTTP para URLs fornecidas por usuários/fontes (sites de empresas).
 * Proteções contra SSRF:
 *  - só http/https e portas 80/443/8080/8443;
 *  - bloqueia nomes internos (sem ponto, .local, .internal, localhost, metadados de nuvem);
 *  - a resolução DNS acontece DENTRO da conexão (lookup customizado) e rejeita qualquer IP
 *    privado, loopback, link-local, CGNAT, multicast ou reservado — inclusive em redirecionamentos
 *    e contra DNS rebinding, porque o IP validado é o mesmo usado na conexão;
 *  - redirecionamentos manuais (máx. 5), revalidados a cada salto;
 *  - limite de tempo e de tamanho da resposta.
 */

export class BlockedUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlockedUrlError";
  }
}

const allowHosts = () =>
  new Set(
    env.CRAWLER_ALLOW_HOSTS.split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );

function ipv4ToInt(ip: string) {
  return ip.split(".").reduce((acc, oct) => (acc << 8) + Number(oct), 0) >>> 0;
}
const V4_BLOCKS: [string, number][] = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4], ["255.255.255.255", 32],
];

export function isPrivateIp(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) {
    const n = ipv4ToInt(ip);
    return V4_BLOCKS.some(([base, bits]) => {
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
      return (n & mask) === (ipv4ToInt(base) & mask);
    });
  }
  if (family === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::" || lower === "::1") return true;
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]!);
    if (/^::ffff:[0-9a-f]{1,4}:[0-9a-f]{1,4}$/.test(lower)) return true; // v4 mapeado em hex: bloqueia por segurança
    if (/^f[cd][0-9a-f]{2}:/.test(lower)) return true; // fc00::/7 (ULA)
    if (/^fe[89ab][0-9a-f]:/.test(lower)) return true; // fe80::/10
    if (/^ff[0-9a-f]{2}:/.test(lower)) return true; // multicast
    if (lower.startsWith("2001:db8:")) return true; // documentação
    if (lower.startsWith("64:ff9b:")) return true; // NAT64 pode mapear para redes internas
    return false;
  }
  return true;
}

const BLOCKED_NAMES = /(^localhost$|\.localhost$|\.local$|\.internal$|\.intranet$|\.lan$|\.home$|\.corp$|^metadata\.google\.internal$|^metadata$)/i;
const ALLOWED_PORTS = new Set(["", "80", "443", "8080", "8443"]);

/** Valida a URL sem rede (esquema, porta, nome). A checagem de IP ocorre na conexão. */
export function assertSafeUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new BlockedUrlError("URL inválida.");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new BlockedUrlError("Somente http e https são permitidos.");
  if (u.username || u.password) throw new BlockedUrlError("URLs com credenciais não são permitidas.");
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (allowHosts().has(host)) return u;
  if (!ALLOWED_PORTS.has(u.port)) throw new BlockedUrlError(`Porta ${u.port} não permitida.`);
  if (isIP(host)) {
    if (isPrivateIp(host)) throw new BlockedUrlError("Endereço IP interno ou reservado bloqueado.");
    return u;
  }
  if (!host.includes(".") || BLOCKED_NAMES.test(host)) throw new BlockedUrlError("Destino interno bloqueado.");
  return u;
}

type LookupCb = (err: NodeJS.ErrnoException | null, address: string | { address: string; family: number }[], family?: number) => void;

/** lookup usado pelo socket: resolve e recusa IPs internos (exceto hosts liberados explicitamente para testes). */
function guardedLookup(hostname: string, options: { all?: boolean; family?: number } | number, cb: LookupCb) {
  const opts = typeof options === "number" ? { family: options } : (options ?? {});
  const allowed = allowHosts().has(hostname.toLowerCase());
  dnsLookup(hostname, { all: true, family: opts.family ?? 0, verbatim: true }, (err, addresses) => {
    if (err) return cb(err, []);
    const list = (addresses as { address: string; family: number }[]).filter((a) => allowed || !isPrivateIp(a.address));
    if (!list.length) {
      const e = new BlockedUrlError(`O domínio ${hostname} aponta para um endereço interno — acesso bloqueado.`) as unknown as NodeJS.ErrnoException;
      e.code = "EBLOCKED";
      return cb(e, []);
    }
    if (opts.all) return cb(null, list);
    cb(null, list[0]!.address, list[0]!.family);
  });
}

export const safeAgent: Dispatcher = new Agent({
  connect: { lookup: guardedLookup as never, timeout: 8000 },
  headersTimeout: 12_000,
  bodyTimeout: 15_000,
  maxRedirections: 0,
} as ConstructorParameters<typeof Agent>[0]);

export type SafeResponse = {
  url: string;
  finalUrl: string;
  status: number;
  headers: Headers;
  body: string;
  contentType: string;
  redirects: string[];
  elapsedMs: number;
  truncated: boolean;
};

export async function safeFetch(
  rawUrl: string,
  opts: { method?: "GET" | "HEAD"; maxBytes?: number; timeoutMs?: number; accept?: string; maxRedirects?: number } = {},
): Promise<SafeResponse> {
  const maxBytes = opts.maxBytes ?? 2_500_000;
  const started = Date.now();
  const redirects: string[] = [];
  let current = assertSafeUrl(rawUrl).toString();
  for (let hop = 0; hop <= (opts.maxRedirects ?? 5); hop++) {
    const res = await undiciFetch(current, {
      method: opts.method ?? "GET",
      redirect: "manual",
      dispatcher: safeAgent,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
      headers: {
        "User-Agent": env.HTTP_USER_AGENT,
        Accept: opts.accept ?? "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.6",
      },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      const next = new URL(res.headers.get("location")!, current).toString();
      await res.body?.cancel().catch(() => undefined);
      assertSafeUrl(next);
      redirects.push(next);
      current = next;
      continue;
    }
    let body = "";
    let truncated = false;
    if (opts.method !== "HEAD" && res.body) {
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) {
          truncated = true;
          await reader.cancel().catch(() => undefined);
          break;
        }
        chunks.push(value);
      }
      body = new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks));
    }
    return {
      url: rawUrl,
      finalUrl: current,
      status: res.status,
      headers: res.headers as unknown as Headers,
      body,
      contentType: res.headers.get("content-type") ?? "",
      redirects,
      elapsedMs: Date.now() - started,
      truncated,
    };
  }
  throw new BlockedUrlError("Redirecionamentos demais.");
}
