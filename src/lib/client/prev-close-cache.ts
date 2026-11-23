import { shanghaiDateString } from "../market-hours";
import { PREV_CLOSE_PAYLOAD_VERSION } from "../prev-close-version";
import type { HistoryCacheItem, MarketPayload } from "../types";

export const PREV_CLOSE_CACHE_KEY = `etf-market-prev-close-v${PREV_CLOSE_PAYLOAD_VERSION}`;

export interface PrevCloseCacheEntry {
  asOfDate: string;
  shanghaiDate: string;
  savedAt: number;
  payload: MarketPayload;
}

const DB_NAME = "etf-market";
const STORE = "snapshots";
const LEGACY_IDB_KEY = `prev-close-v${PREV_CLOSE_PAYLOAD_VERSION}`;
const LIVE_KEY_PREFIX = "live-v1-";

function historyKey(date: string) {
  return `history-v${PREV_CLOSE_PAYLOAD_VERSION}-${date}`;
}

function liveKey(date: string) {
  return `${LIVE_KEY_PREFIX}${date}`;
}

function isLiveCacheKey(key: string): boolean {
  return key.startsWith(LIVE_KEY_PREFIX);
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
  });
}

export function isHistoryCacheValid(entry: PrevCloseCacheEntry | null, date: string): boolean {
  return Boolean(
    entry &&
      entry.asOfDate === date &&
      entry.payload?.asOfDate === date &&
      entry.payload.view === "prev-close" &&
      entry.payload.payloadVersion === PREV_CLOSE_PAYLOAD_VERSION &&
      Array.isArray(entry.payload.list) &&
      entry.payload.list.length > 0,
  );
}

export function isPrevCloseCacheFresh(entry: PrevCloseCacheEntry | null, shanghaiDate: string): boolean {
  return Boolean(entry && isHistoryCacheValid(entry, entry.asOfDate) && entry.shanghaiDate === shanghaiDate);
}

export function isLiveSnapshotCacheValid(entry: PrevCloseCacheEntry | null, date: string): boolean {
  return Boolean(
    entry &&
      entry.asOfDate === date &&
      entry.payload?.view === "live" &&
      Array.isArray(entry.payload.list) &&
      entry.payload.list.length > 0,
  );
}

async function idbGet(key: string): Promise<PrevCloseCacheEntry | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve((req.result as PrevCloseCacheEntry | undefined) ?? null);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB read failed"));
  });
}

async function idbPut(key: string, entry: PrevCloseCacheEntry): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(entry, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB write failed"));
  });
}

async function idbDelete(key: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB delete failed"));
  });
}

async function idbKeys(): Promise<string[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAllKeys();
    req.onsuccess = () => resolve((req.result as IDBValidKey[]).map(String));
    req.onerror = () => reject(req.error ?? new Error("IndexedDB keys failed"));
  });
}

function readLocalFallback(date?: string): PrevCloseCacheEntry | null {
  try {
    const raw = localStorage.getItem(date ? historyKey(date) : PREV_CLOSE_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PrevCloseCacheEntry;
  } catch {
    return null;
  }
}

function writeLocalFallback(date: string, entry: PrevCloseCacheEntry) {
  try {
    localStorage.setItem(historyKey(date), JSON.stringify(entry));
  } catch {
    // quota or private mode
  }
}

export async function readHistoryCache(date: string): Promise<PrevCloseCacheEntry | null> {
  try {
    const fromIdb = (await idbGet(historyKey(date))) ?? (await idbGet(LEGACY_IDB_KEY));
    if (fromIdb && isHistoryCacheValid(fromIdb, date)) return fromIdb;
  } catch {
    /* fall through */
  }
  const fallback = readLocalFallback(date) ?? readLocalFallback();
  return fallback && isHistoryCacheValid(fallback, date) ? fallback : null;
}

export async function writeHistoryCache(entry: PrevCloseCacheEntry): Promise<void> {
  try {
    await idbPut(historyKey(entry.asOfDate), entry);
  } catch {
    writeLocalFallback(entry.asOfDate, entry);
  }
}

function writeLiveLocalFallback(date: string, entry: PrevCloseCacheEntry) {
  try {
    localStorage.setItem(liveKey(date), JSON.stringify(entry));
  } catch {
    // quota or private mode
  }
}

async function persistLiveSnapshot(payload: MarketPayload, now = Date.now()): Promise<void> {
  if (payload.view !== "live" || !Array.isArray(payload.list) || payload.list.length === 0) return;
  const date = shanghaiDateString(now);
  const entry: PrevCloseCacheEntry = {
    asOfDate: date,
    shanghaiDate: date,
    savedAt: now,
    payload,
  };
  try {
    await idbPut(liveKey(date), entry);
  } catch {
    writeLiveLocalFallback(date, entry);
  }
}

let liveWriteInFlight: Promise<void> | null = null;
let queuedLivePayload: MarketPayload | null = null;

/** 把成功加载的「今日市场」快照写入本机历史缓存列表。保持 payload.view === "live"，不会改写成收盘磁带，也不会改写折溢价。 */
export function writeLiveSnapshotCache(payload: MarketPayload): Promise<void> {
  queuedLivePayload = payload;
  if (liveWriteInFlight) return liveWriteInFlight;
  const run = async () => {
    try {
      while (queuedLivePayload) {
        const next = queuedLivePayload;
        queuedLivePayload = null;
        await persistLiveSnapshot(next);
      }
    } finally {
      liveWriteInFlight = null;
    }
    if (queuedLivePayload) return writeLiveSnapshotCache(queuedLivePayload);
  };
  liveWriteInFlight = run();
  return liveWriteInFlight;
}

function asEpochSeconds(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value > 1e12 ? Math.floor(value / 1000) : Math.floor(value);
}

function estimateEntryBytes(entry: PrevCloseCacheEntry): number {
  try {
    return new Blob([JSON.stringify(entry)]).size;
  } catch {
    return 0;
  }
}

function cacheItemKey(item: HistoryCacheItem): string {
  return `${item.kind}:${item.date}`;
}

function toCacheItem(entry: PrevCloseCacheEntry, sizeBytes?: number): HistoryCacheItem | null {
  const closeOk = isHistoryCacheValid(entry, entry.asOfDate);
  const liveOk = isLiveSnapshotCacheValid(entry, entry.asOfDate);
  if (!closeOk && !liveOk) return null;
  return {
    date: entry.asOfDate,
    etfCount: entry.payload.list.length,
    savedAt: asEpochSeconds(entry.savedAt),
    sizeBytes: sizeBytes && sizeBytes > 0 ? sizeBytes : estimateEntryBytes(entry),
    kind: liveOk ? "live" : "close",
    freshness: entry.payload.freshness ?? null,
  };
}

export async function listClientHistoryCache(): Promise<HistoryCacheItem[]> {
  const items = new Map<string, HistoryCacheItem>();
  const add = (entry: PrevCloseCacheEntry | null, sizeBytes?: number) => {
    if (!entry) return;
    const item = toCacheItem(entry, sizeBytes);
    if (!item) return;
    const key = cacheItemKey(item);
    const prev = items.get(key);
    if (prev && prev.savedAt >= item.savedAt) return;
    items.set(key, item);
  };
  try {
    const keys = await idbKeys();
    for (const key of keys) {
      if (!(key.startsWith("history-v") || key === LEGACY_IDB_KEY || isLiveCacheKey(key))) continue;
      add(await idbGet(key));
    }
  } catch {
    /* fall through to localStorage */
  }
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !(key.startsWith("history-v") || key === PREV_CLOSE_CACHE_KEY || isLiveCacheKey(key))) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      try {
        add(JSON.parse(raw) as PrevCloseCacheEntry, new Blob([raw]).size);
      } catch {
        /* ignore one bad entry */
      }
    }
  } catch {
    /* private mode */
  }
  return [...items.values()].sort((a, b) => {
    const byDate = b.date.localeCompare(a.date);
    if (byDate !== 0) return byDate;
    if (a.kind === b.kind) return 0;
    return a.kind === "live" ? -1 : 1;
  });
}

export async function deleteClientHistoryCache(date: string): Promise<void> {
  try {
    await idbDelete(historyKey(date));
    await idbDelete(liveKey(date));
    const legacy = await idbGet(LEGACY_IDB_KEY);
    if (legacy?.asOfDate === date) await idbDelete(LEGACY_IDB_KEY);
  } catch {
    /* ignore */
  }
  try {
    localStorage.removeItem(historyKey(date));
    localStorage.removeItem(liveKey(date));
    const raw = localStorage.getItem(PREV_CLOSE_CACHE_KEY);
    if (raw) {
      const entry = JSON.parse(raw) as PrevCloseCacheEntry;
      if (entry?.asOfDate === date) localStorage.removeItem(PREV_CLOSE_CACHE_KEY);
    }
  } catch {
    /* ignore */
  }
}

export async function deleteAllClientHistoryCache(): Promise<void> {
  try {
    const keys = await idbKeys();
    for (const key of keys) {
      if (key.startsWith("history-v") || key === LEGACY_IDB_KEY || isLiveCacheKey(key)) await idbDelete(key);
    }
  } catch {
    /* ignore */
  }
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.startsWith("history-v") || key === PREV_CLOSE_CACHE_KEY || isLiveCacheKey(key))) toRemove.push(key);
    }
    for (const key of toRemove) localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export async function readPrevCloseCache(): Promise<PrevCloseCacheEntry | null> {
  try {
    const fromIdb = await idbGet(LEGACY_IDB_KEY);
    if (fromIdb) return fromIdb;
  } catch {
    /* fall through */
  }
  return readLocalFallback();
}

export async function writePrevCloseCache(entry: PrevCloseCacheEntry): Promise<void> {
  return writeHistoryCache(entry);
}
