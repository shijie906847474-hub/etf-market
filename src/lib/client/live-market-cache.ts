import type { MarketPayload } from "../types";

const STORAGE_KEY = "etf-market-live-v1";

let memory: MarketPayload | null = null;

function isValidLive(payload: MarketPayload | null): payload is MarketPayload {
  return Boolean(payload && payload.view === "live" && Array.isArray(payload.list) && payload.list.length > 0);
}

export function readLiveMarketCache(): MarketPayload | null {
  if (isValidLive(memory)) return memory;
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MarketPayload;
    if (isValidLive(parsed)) {
      memory = parsed;
      return parsed;
    }
  } catch {
    /* quota, private mode, or bad JSON */
  }
  return null;
}

export function writeLiveMarketCache(payload: MarketPayload): void {
  if (!isValidLive(payload)) return;
  memory = payload;
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* quota or private mode; memory cache still works in this tab */
  }
}
