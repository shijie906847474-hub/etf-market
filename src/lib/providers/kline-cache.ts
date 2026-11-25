import type { KlineBar } from "../types";

export type KlineFetchSource = "eastmoney" | "tencent";

type CachedKline = {
  bars: KlineBar[];
  source: KlineFetchSource;
  limit: number;
  updatedAt: number;
};

const KLINE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

const cache = new Map<string, CachedKline>();

function cacheKey(secid: string, klt: 101 | 102 | 103): string {
  return `${secid}|${klt}`;
}

export function getCachedKline(secid: string, klt: 101 | 102 | 103, limit: number): CachedKline | null {
  const hit = cache.get(cacheKey(secid, klt));
  if (!hit) return null;
  if (Date.now() - hit.updatedAt > KLINE_CACHE_TTL_MS) {
    cache.delete(cacheKey(secid, klt));
    return null;
  }
  if (hit.limit < limit) return null;
  return hit;
}

export function setCachedKline(
  secid: string,
  klt: 101 | 102 | 103,
  limit: number,
  bars: KlineBar[],
  source: KlineFetchSource,
): void {
  const key = cacheKey(secid, klt);
  const prev = cache.get(key);
  if (prev && prev.limit > limit && Date.now() - prev.updatedAt <= KLINE_CACHE_TTL_MS) return;
  cache.set(key, { bars, source, limit, updatedAt: Date.now() });
}

export function resetKlineCache(): void {
  cache.clear();
}

export function klineCacheSize(): number {
  return cache.size;
}
