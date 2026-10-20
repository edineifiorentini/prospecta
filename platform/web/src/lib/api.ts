// Cliente HTTP da API (mesma origem: /api). Injeta o token CSRF em escritas
// e normaliza erros no formato { statusCode, code, message, details }.

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

let csrfToken: string | null = null;
export const setCsrfToken = (t: string | null) => {
  csrfToken = t;
};

type Options = Omit<RequestInit, "body"> & { body?: unknown; query?: Record<string, unknown> };

function buildUrl(path: string, query?: Record<string, unknown>) {
  const url = new URL(path.startsWith("/api") ? path : `/api${path}`, window.location.origin);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === "") continue;
      if (Array.isArray(v)) v.forEach((item) => url.searchParams.append(k, String(item)));
      else url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

export async function api<T = unknown>(path: string, opts: Options = {}): Promise<T> {
  const method = (opts.method ?? "GET").toUpperCase();
  const headers = new Headers(opts.headers);
  let body: BodyInit | undefined;
  if (opts.body instanceof FormData) body = opts.body;
  else if (opts.body !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(opts.body);
  }
  if (method !== "GET" && method !== "HEAD" && csrfToken) headers.set("x-csrf-token", csrfToken);

  let res: Response;
  try {
    res = await fetch(buildUrl(path, opts.query), { ...opts, method, headers, body, credentials: "same-origin", cache: "no-store" });
  } catch {
    throw new ApiError(0, "OFFLINE", "Sem conexão com o servidor. Verifique se a plataforma está em execução.");
  }

  if (res.status === 204) return undefined as T;
  const type = res.headers.get("content-type") ?? "";
  const payload = type.includes("application/json") ? await res.json().catch(() => null) : await res.text();

  if (!res.ok) {
    const p = (payload && typeof payload === "object" ? payload : {}) as { code?: string; message?: string; details?: unknown };
    if (res.status === 401 && typeof window !== "undefined" && !path.startsWith("/auth/") && !path.startsWith("/setup")) {
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      // navegação completa de propósito: descarta o estado da sessão expirada
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = `/login?next=${next}`;
    }
    if (p.code === "PASSWORD_CHANGE_REQUIRED" && typeof window !== "undefined" && window.location.pathname !== "/trocar-senha") {
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = "/trocar-senha";
    }
    throw new ApiError(res.status, p.code ?? "ERROR", p.message ?? `Erro ${res.status}`, p.details);
  }
  return payload as T;
}

/** Abre um download autenticado (CSV/PDF) respeitando o cookie de sessão. */
export function downloadUrl(path: string, query?: Record<string, unknown>) {
  return buildUrl(path, query);
}

export const errorMessage = (err: unknown) =>
  err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Algo deu errado. Tente novamente.";

/** Baixa um arquivo autenticado mostrando o erro da API (ex.: PDF indisponível) em vez de abrir uma página de erro. */
export async function downloadFile(path: string, query?: Record<string, unknown>) {
  let res: Response;
  try {
    res = await fetch(buildUrl(path, query), { credentials: "same-origin", cache: "no-store" });
  } catch {
    throw new ApiError(0, "OFFLINE", "Sem conexão com o servidor.");
  }
  if (!res.ok) {
    const p = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
    throw new ApiError(res.status, p.code ?? "ERROR", p.message ?? `Erro ${res.status}`);
  }
  const name = res.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ?? "download";
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return name;
}
