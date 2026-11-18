import { PREV_CLOSE_PAYLOAD_VERSION } from "../prev-close-version";
import type { MarketPayload } from "../types";

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

function historyKey(date: string) {
  return `history-v${PREV_CLOSE_PAYLOAD_VERSION}-${date}`;
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

export async function deleteClientHistoryCache(date: string): Promise<void> {
  try {
    await idbDelete(historyKey(date));
    const legacy = await idbGet(LEGACY_IDB_KEY);
    if (legacy?.asOfDate === date) await idbDelete(LEGACY_IDB_KEY);
  } catch {
    /* ignore */
  }
  try {
    localStorage.removeItem(historyKey(date));
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
      if (key.startsWith("history-v") || key === LEGACY_IDB_KEY) await idbDelete(key);
    }
  } catch {
    /* ignore */
  }
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.startsWith("history-v") || key === PREV_CLOSE_CACHE_KEY)) toRemove.push(key);
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
