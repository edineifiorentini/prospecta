import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BasicCrawler, Configuration, log as crawleeLog, LogLevel } from "@crawlee/cheerio";
import { env } from "../../config/env.ts";
import { logger } from "../../lib/logger.ts";
import { BlockedUrlError, assertSafeUrl, safeFetch } from "../../lib/safe-fetch.ts";
import { hostOf } from "../../lib/normalize.ts";
import { extractPage, looksJsRendered, pickPriorityLinks, type PageExtraction } from "./extract.ts";

crawleeLog.setLevel(LogLevel.WARNING);
// o Crawlee salva estado periodicamente em ./storage; no container /app não é gravável e a falha deixava a coleta parada
process.env.CRAWLEE_STORAGE_DIR ??= join(tmpdir(), "prospecta-crawlee");
process.env.CRAWLEE_PERSIST_STORAGE ??= "false";

/** Tempo máximo da fila de páginas secundárias; ao estourar, segue com as páginas já lidas. */
const CRAWL_RUN_TIMEOUT_MS = 120_000;

// robots-parser é CommonJS (module.exports = função)
type Robot = { isAllowed(url: string, ua?: string): boolean | undefined; getSitemaps(): string[] };
const robotsParser = createRequire(import.meta.url)("robots-parser") as (url: string, body: string) => Robot;

export type CrawlPage = PageExtraction & { status: number; finalUrl: string; elapsedMs: number; rendered: "http" | "browser" };
export type CrawlResult = {
  startUrl: string;
  finalUrl: string | null;
  reachable: boolean;
  httpStatus: number | null;
  https: boolean;
  httpRedirectsToHttps: boolean | null;
  /** o site responde em HTTPS mesmo quando a URL informada é HTTP */
  httpsAvailable: boolean | null;
  responseTimeMs: number | null;
  robots: { found: boolean; allowedHome: boolean; blocked: string[]; sitemaps: string[] };
  sitemapFound: boolean;
  pages: CrawlPage[];
  method: "cheerio" | "playwright" | "cheerio+playwright";
  errors: { url: string; message: string }[];
  blockedReason: string | null;
  /** consulta o robots.txt do site para qualquer URL (respeitado também na checagem de links) */
  robotsAllows: (url: string) => boolean;
};

const BOT_UA_TOKEN = "ProspectaBot";

async function loadRobots(origin: string) {
  const robotsUrl = `${origin}/robots.txt`;
  try {
    const r = await safeFetch(robotsUrl, { accept: "text/plain,*/*", maxBytes: 300_000, timeoutMs: 10_000 });
    if (r.status >= 200 && r.status < 300 && !/text\/html/i.test(r.contentType)) {
      return { found: true, parser: robotsParser(robotsUrl, r.body) };
    }
  } catch {
    /* robots inacessível: segue a regra padrão (permitido) */
  }
  return { found: false, parser: robotsParser(robotsUrl, "") };
}

/** Renderiza com Playwright (Chromium) bloqueando qualquer requisição a destinos internos. */
async function renderWithBrowser(url: string): Promise<{ html: string; finalUrl: string; status: number; elapsedMs: number } | null> {
  let chromium: typeof import("playwright").chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    return null;
  }
  const started = Date.now();
  if (!existsSync(chromium.executablePath())) return null;
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] }).catch((err) => {
    logger.warn({ err: (err as Error).message }, "Chromium indisponível para renderização");
    return null;
  });
  if (!browser) return null;
  try {
    const context = await browser.newContext({ userAgent: env.HTTP_USER_AGENT, javaScriptEnabled: true, serviceWorkers: "block" });
    const page = await context.newPage();
    await page.route("**/*", async (route) => {
      const reqUrl = route.request().url();
      if (reqUrl.startsWith("data:") || reqUrl.startsWith("blob:")) return route.continue();
      try {
        assertSafeUrl(reqUrl);
      } catch {
        return route.abort("blockedbyclient");
      }
      // reduz carga: imagens, fontes e mídia não são necessárias para extrair contatos
      const type = route.request().resourceType();
      if (["image", "media", "font"].includes(type)) return route.abort();
      return route.continue();
    });
    const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25_000 });
    await page.waitForLoadState("networkidle", { timeout: 6000 }).catch(() => undefined);
    const html = await page.content();
    return { html, finalUrl: page.url(), status: resp?.status() ?? 0, elapsedMs: Date.now() - started };
  } catch (err) {
    logger.debug({ err: (err as Error).message, url }, "falha ao renderizar com navegador");
    return null;
  } finally {
    await browser.close().catch(() => undefined);
  }
}

/**
 * Visita o site oficial priorizando Home, Contato, Sobre e Serviços.
 * Respeita robots.txt, não acessa áreas autenticadas e limita páginas/tempo.
 */
export async function crawlWebsite(startUrl: string, opts: { maxPages?: number; allowBrowser?: boolean } = {}): Promise<CrawlResult> {
  const maxPages = opts.maxPages ?? 6;
  const result: CrawlResult = {
    startUrl,
    finalUrl: null,
    reachable: false,
    httpStatus: null,
    https: startUrl.startsWith("https:"),
    httpRedirectsToHttps: null,
    httpsAvailable: null,
    responseTimeMs: null,
    robots: { found: false, allowedHome: true, blocked: [], sitemaps: [] },
    sitemapFound: false,
    pages: [],
    method: "cheerio",
    errors: [],
    blockedReason: null,
    robotsAllows: () => true,
  };

  try {
    assertSafeUrl(startUrl);
  } catch (err) {
    result.blockedReason = (err as Error).message;
    return result;
  }

  // 1) página inicial (determina URL final, HTTPS e tempo de resposta)
  let home;
  try {
    home = await safeFetch(startUrl);
  } catch (err) {
    const msg = err instanceof BlockedUrlError ? err.message : `Site inacessível: ${(err as Error).cause ? ((err as Error).cause as Error).message : (err as Error).message}`;
    result.errors.push({ url: startUrl, message: msg.slice(0, 200) });
    if (err instanceof BlockedUrlError) result.blockedReason = err.message;
    return result;
  }
  result.finalUrl = home.finalUrl;
  result.httpStatus = home.status;
  result.responseTimeMs = home.elapsedMs;
  result.reachable = home.status >= 200 && home.status < 400;
  result.https = home.finalUrl.startsWith("https:");
  const origin = new URL(home.finalUrl).origin;

  // HTTP redireciona para HTTPS?
  if (result.https) {
    try {
      const plain = await safeFetch(home.finalUrl.replace(/^https:/, "http:"), { method: "HEAD", timeoutMs: 8000, maxRedirects: 2 });
      result.httpRedirectsToHttps = plain.finalUrl.startsWith("https:");
    } catch {
      result.httpRedirectsToHttps = null;
    }
  }

  if (result.https) result.httpsAvailable = true;
  else {
    try {
      const sec = await safeFetch(home.finalUrl.replace(/^http:/, "https:"), { method: "HEAD", timeoutMs: 8000, maxRedirects: 2 });
      result.httpsAvailable = sec.status < 500;
    } catch {
      result.httpsAvailable = false;
    }
  }

  const robots = await loadRobots(origin);
  result.robots.found = robots.found;
  result.robots.sitemaps = robots.parser.getSitemaps().slice(0, 5);
  result.robotsAllows = (u: string) => robots.parser.isAllowed(u, BOT_UA_TOKEN) !== false;
  result.robots.allowedHome = result.robotsAllows(home.finalUrl);
  if (!result.robots.allowedHome) {
    result.robots.blocked.push(home.finalUrl);
    result.blockedReason = "robots.txt não permite acesso automatizado a este site.";
    return result;
  }

  try {
    const sm = await safeFetch(result.robots.sitemaps[0] ?? `${origin}/sitemap.xml`, { method: "GET", maxBytes: 200_000, timeoutMs: 8000, accept: "application/xml,text/xml,*/*" });
    result.sitemapFound = sm.status === 200 && /<(urlset|sitemapindex)/i.test(sm.body);
  } catch {
    result.sitemapFound = false;
  }

  if (!result.reachable || !/html/i.test(home.contentType)) {
    result.errors.push({ url: home.finalUrl, message: `Resposta HTTP ${home.status} (${home.contentType || "sem tipo"})` });
    return result;
  }

  const homeEx = extractPage(home.body, home.finalUrl);
  result.pages.push({ ...homeEx, status: home.status, finalUrl: home.finalUrl, elapsedMs: home.elapsedMs, rendered: "http" });
  let needsBrowser = looksJsRendered(home.body, homeEx);

  // 2) páginas prioritárias via Crawlee (fila, retries limitados, concorrência baixa)
  const targets = pickPriorityLinks(homeEx.internalLinks, maxPages - 1).filter((u) => {
    const allowed = robots.parser.isAllowed(u, BOT_UA_TOKEN) !== false;
    if (!allowed) result.robots.blocked.push(u);
    return allowed && hostOf(u) === hostOf(home.finalUrl);
  });

  if (targets.length) {
    const config = new Configuration({ persistStorage: false, purgeOnStart: true });
    const crawler = new BasicCrawler(
      {
        maxRequestsPerCrawl: targets.length,
        maxConcurrency: 2,
        maxRequestRetries: 1,
        requestHandlerTimeoutSecs: 30,
        useSessionPool: false,
        async requestHandler({ request }) {
          const res = await safeFetch(request.url);
          if (res.status >= 400 || !/html/i.test(res.contentType)) throw new Error(`HTTP ${res.status}`);
          if (hostOf(res.finalUrl) !== hostOf(home.finalUrl)) return; // saiu do site oficial
          const ex = extractPage(res.body, res.finalUrl);
          result.pages.push({ ...ex, status: res.status, finalUrl: res.finalUrl, elapsedMs: res.elapsedMs, rendered: "http" });
        },
        failedRequestHandler({ request }, error) {
          result.errors.push({ url: request.url, message: (error as Error).message.slice(0, 200) });
        },
      },
      config,
    );
    let timer: NodeJS.Timeout | undefined;
    const timedOut = new Promise<"timeout">((resolve) => (timer = setTimeout(() => resolve("timeout"), CRAWL_RUN_TIMEOUT_MS)));
    const outcome = await Promise.race([crawler.run(targets.map((url) => ({ url, uniqueKey: url }))), timedOut]).finally(() => clearTimeout(timer));
    if (outcome === "timeout") {
      result.errors.push({ url: home.finalUrl, message: `Páginas secundárias interrompidas após ${CRAWL_RUN_TIMEOUT_MS / 1000}s.` });
      await crawler.teardown().catch(() => undefined);
    }
  }

  // 3) fallback com navegador para sites que dependem de JavaScript
  const totalContacts = result.pages.reduce((n, p) => n + p.emails.length + p.phones.length + p.socials.length + p.whatsapp.length, 0);
  if ((needsBrowser || totalContacts === 0) && opts.allowBrowser !== false) {
    const rendered = await renderWithBrowser(home.finalUrl);
    if (rendered && rendered.html) {
      const ex = extractPage(rendered.html, rendered.finalUrl);
      result.pages.push({ ...ex, status: rendered.status, finalUrl: rendered.finalUrl, elapsedMs: rendered.elapsedMs, rendered: "browser" });
      result.method = "cheerio+playwright";
      needsBrowser = false;
    }
  }
  return result;
}
