import { promises as dns } from "node:dns";
import { existsSync } from "node:fs";
import { logger } from "../../lib/logger.ts";
import { assertSafeUrl, isPrivateIp, safeFetch } from "../../lib/safe-fetch.ts";
import { env } from "../../config/env.ts";
import type { LighthouseSummary } from "./evaluate.ts";

async function chromePath(): Promise<string | undefined> {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  try {
    const { chromium } = await import("playwright");
    return chromium.executablePath();
  } catch {
    return undefined;
  }
}

/** Confere (antes de abrir o Chrome) que o host resolve apenas para IPs públicos. */
async function assertPublicHost(url: string) {
  const u = assertSafeUrl(url);
  if (env.CRAWLER_ALLOW_HOSTS.split(",").map((s) => s.trim()).includes(u.hostname)) return;
  const addrs = await dns.lookup(u.hostname, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new Error("Destino interno bloqueado para o Lighthouse.");
}

/** Executa o Lighthouse (perfil celular) localmente; devolve null se o Chrome não estiver disponível. */
export async function runLighthouse(url: string, timeoutMs = 90_000): Promise<LighthouseSummary | null> {
  try {
    await assertPublicHost(url);
  } catch (err) {
    logger.warn({ err: (err as Error).message, url }, "Lighthouse não executado");
    return null;
  }
  const path = await chromePath();
  // sem o executável, o chrome-launcher emite erro assíncrono que derrubaria o processo
  if (!path || !existsSync(path)) {
    logger.warn({ path }, "Chromium não encontrado; Lighthouse ignorado (use a versão em Docker)");
    return null;
  }
  const chromeLauncher = await import("chrome-launcher");
  let chrome: Awaited<ReturnType<typeof chromeLauncher.launch>> | null = null;
  try {
    chrome = await chromeLauncher.launch({
      chromePath: path,
      chromeFlags: ["--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--no-first-run"],
      logLevel: "silent",
    });
    const { default: lighthouse } = await import("lighthouse");
    const run = lighthouse(url, {
      port: chrome.port,
      output: "json",
      logLevel: "error",
      onlyCategories: ["performance", "accessibility", "best-practices", "seo"],
      formFactor: "mobile",
      maxWaitForLoad: 45_000,
    });
    const result = await Promise.race([run, new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs))]);
    if (!result?.lhr) return null;
    const lhr = result.lhr;
    const score = (k: string) => lhr.categories[k]?.score ?? null;
    const metric = (id: string) => (typeof lhr.audits[id]?.numericValue === "number" ? Math.round(lhr.audits[id]!.numericValue!) : null);
    return {
      performance: score("performance"),
      accessibility: score("accessibility"),
      bestPractices: score("best-practices"),
      seo: score("seo"),
      lcpMs: metric("largest-contentful-paint"),
      cls: typeof lhr.audits["cumulative-layout-shift"]?.numericValue === "number" ? Number(lhr.audits["cumulative-layout-shift"]!.numericValue!.toFixed(3)) : null,
      tbtMs: metric("total-blocking-time"),
      fcpMs: metric("first-contentful-paint"),
      formFactor: "mobile",
      fetchedAt: new Date().toISOString(),
      finalUrl: lhr.finalDisplayedUrl ?? url,
    };
  } catch (err) {
    logger.warn({ err: (err as Error).message.slice(0, 200), url }, "Lighthouse falhou; usando métricas alternativas");
    return null;
  } finally {
    try {
      chrome?.kill();
    } catch {
      /* já encerrado */
    }
  }
}

/** Verifica até N links internos (GET leve, sem seguir para fora do site). */
export async function checkInternalLinks(urls: string[], max = 15) {
  const unique = [...new Set(urls)].slice(0, max);
  const broken: { url: string; status: number | null }[] = [];
  let i = 0;
  const worker = async () => {
    while (i < unique.length) {
      const url = unique[i++]!;
      try {
        const r = await safeFetch(url, { method: "GET", maxBytes: 50_000, timeoutMs: 10_000, maxRedirects: 3 });
        if (r.status >= 400) broken.push({ url, status: r.status });
      } catch {
        broken.push({ url, status: null });
      }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return { checked: unique.length, broken };
}
