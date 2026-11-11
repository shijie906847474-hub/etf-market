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
const IDB_KEY = `prev-close-v${PREV_CLOSE_PAYLOAD_VERSION}`;

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

export function isPrevCloseCacheFresh(entry: PrevCloseCacheEntry | null, shanghaiDate: string): boolean {
  return Boolean(
    entry &&
      entry.shanghaiDate === shanghaiDate &&
      entry.asOfDate &&
      entry.payload?.view === "prev-close" &&
      entry.payload.payloadVersion === PREV_CLOSE_PAYLOAD_VERSION &&
      Array.isArray(entry.payload.list) &&
      entry.payload.list.length > 0,
  );
}

async function readIdb(): Promise<PrevCloseCacheEntry | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(IDB_KEY);
    req.onsuccess = () => resolve((req.result as PrevCloseCacheEntry | undefined) ?? null);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB read failed"));
  });
}

async function writeIdb(entry: PrevCloseCacheEntry): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(entry, IDB_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB write failed"));
  });
}

function readLocalFallback(): PrevCloseCacheEntry | null {
  try {
    const raw = localStorage.getItem(PREV_CLOSE_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PrevCloseCacheEntry;
  } catch {
    return null;
  }
}

function writeLocalFallback(entry: PrevCloseCacheEntry) {
  try {
    localStorage.setItem(PREV_CLOSE_CACHE_KEY, JSON.stringify(entry));
  } catch {
    // quota or private mode: IndexedDB is the primary store
  }
}

export async function readPrevCloseCache(): Promise<PrevCloseCacheEntry | null> {
  try {
    const fromIdb = await readIdb();
    if (fromIdb) return fromIdb;
  } catch {
    /* fall through */
  }
  return readLocalFallback();
}

export async function writePrevCloseCache(entry: PrevCloseCacheEntry): Promise<void> {
  try {
    await writeIdb(entry);
  } catch {
    writeLocalFallback(entry);
  }
}
