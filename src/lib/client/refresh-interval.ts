"use client";

import { useEffect, useState } from "react";

export const DEFAULT_REFRESH_INTERVAL_MS = 15000;
export const REFRESH_INTERVAL_STORE_KEY = "etf-market-refresh-interval-ms";
export const REFRESH_INTERVAL_EVENT = "etf-market-refresh-interval";

export type RefreshMode = "manual" | "auto";
export const DEFAULT_REFRESH_MODE: RefreshMode = "auto";
export const REFRESH_MODE_STORE_KEY = "etf-market-refresh-mode";
export const REFRESH_MODE_EVENT = "etf-market-refresh-mode";

export const REFRESH_INTERVAL_OPTIONS: Array<{ ms: number; label: string }> = [
  { ms: 5000, label: "5 秒" },
  { ms: 10000, label: "10 秒" },
  { ms: 15000, label: "15 秒" },
  { ms: 30000, label: "30 秒" },
  { ms: 60000, label: "60 秒" },
];

const ALLOWED = new Set(REFRESH_INTERVAL_OPTIONS.map((x) => x.ms));

export function readRefreshIntervalMs(): number {
  if (typeof window === "undefined") return DEFAULT_REFRESH_INTERVAL_MS;
  try {
    const raw = Number(window.localStorage.getItem(REFRESH_INTERVAL_STORE_KEY));
    if (ALLOWED.has(raw)) return raw;
  } catch {
    /* ignore */
  }
  return DEFAULT_REFRESH_INTERVAL_MS;
}

export function writeRefreshIntervalMs(ms: number): number {
  const next = ALLOWED.has(ms) ? ms : DEFAULT_REFRESH_INTERVAL_MS;
  try {
    window.localStorage.setItem(REFRESH_INTERVAL_STORE_KEY, String(next));
    window.dispatchEvent(new Event(REFRESH_INTERVAL_EVENT));
  } catch {
    /* ignore */
  }
  return next;
}

export function useRefreshInterval(): [number, (ms: number) => void] {
  const [ms, setMs] = useState(DEFAULT_REFRESH_INTERVAL_MS);
  useEffect(() => {
    const sync = () => setMs(readRefreshIntervalMs());
    sync();
    window.addEventListener(REFRESH_INTERVAL_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(REFRESH_INTERVAL_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return [ms, (next) => setMs(writeRefreshIntervalMs(next))];
}

export function readRefreshMode(): RefreshMode {
  if (typeof window === "undefined") return DEFAULT_REFRESH_MODE;
  try {
    const raw = window.localStorage.getItem(REFRESH_MODE_STORE_KEY);
    if (raw === "manual" || raw === "auto") return raw;
  } catch {
    /* ignore */
  }
  return DEFAULT_REFRESH_MODE;
}

export function writeRefreshMode(mode: RefreshMode): RefreshMode {
  const next: RefreshMode = mode === "manual" ? "manual" : "auto";
  try {
    window.localStorage.setItem(REFRESH_MODE_STORE_KEY, next);
    window.dispatchEvent(new Event(REFRESH_MODE_EVENT));
  } catch {
    /* ignore */
  }
  return next;
}

export function useRefreshMode(): [RefreshMode, (mode: RefreshMode) => void] {
  const [mode, setMode] = useState<RefreshMode>(DEFAULT_REFRESH_MODE);
  useEffect(() => {
    const sync = () => setMode(readRefreshMode());
    sync();
    window.addEventListener(REFRESH_MODE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(REFRESH_MODE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return [mode, (next) => setMode(writeRefreshMode(next))];
}
