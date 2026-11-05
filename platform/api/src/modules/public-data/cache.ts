import { prisma, type Prisma } from "../../lib/prisma.ts";
import { redis } from "../../lib/redis.ts";
import { publicMockActive } from "./http.ts";
import type { PublicSourceId } from "./sources.ts";

const DAY = 86_400_000;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export type Cached<T> = { payload: T; fetchedAt: Date; referencePeriod: string | null; cached: boolean };

/**
 * Cache global por fonte. Duas requisições iguais ao mesmo tempo viram uma só consulta (trava no Redis);
 * dado simulado fica em chave separada e nunca é servido como real.
 */
export async function cachedFetch<T>(source: PublicSourceId, rawKey: string, maxAgeDays: number, loader: () => Promise<{ payload: T; referencePeriod?: string | null }>, o: { force?: boolean } = {}): Promise<Cached<T>> {
  const key = publicMockActive() ? `mock:${rawKey}` : rawKey;
  const read = async () => {
    const hit = await prisma.publicDataCache.findUnique({ where: { source_key: { source, key } } });
    return hit && hit.expiresAt > new Date() ? { payload: hit.payload as T, fetchedAt: hit.fetchedAt, referencePeriod: hit.referencePeriod, cached: true } : null;
  };
  if (!o.force && maxAgeDays > 0) {
    const hit = await read();
    if (hit) return hit;
  }
  const lock = `pub:lock:${source}:${key}`;
  for (let i = 0; !(await redis.set(lock, "1", "EX", 90, "NX")); i++) {
    // outra requisição está buscando o mesmo recurso: espera o resultado dela
    if (i >= 60) break;
    await sleep(500);
    const hit = await read();
    if (hit) return hit;
  }
  try {
    const { payload, referencePeriod = null } = await loader();
    const now = new Date();
    const data = { payload: payload as Prisma.InputJsonValue, referencePeriod, fetchedAt: now, expiresAt: new Date(now.getTime() + Math.max(maxAgeDays, 0.01) * DAY) };
    await prisma.publicDataCache.upsert({ where: { source_key: { source, key } }, create: { source, key, ...data }, update: data });
    return { payload, fetchedAt: now, referencePeriod, cached: false };
  } finally {
    await redis.del(lock);
  }
}
