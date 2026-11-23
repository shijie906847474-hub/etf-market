"use client";

import { useCallback, useEffect, useState } from "react";
import { formatShanghai } from "@/lib/format";
import { deleteAllClientHistoryCache, deleteClientHistoryCache, listClientHistoryCache } from "@/lib/client/prev-close-cache";
import type { HistoryCacheItem } from "@/lib/types";
import { REFRESH_INTERVAL_OPTIONS, useRefreshInterval, useRefreshMode, type RefreshMode } from "@/lib/client/refresh-interval";

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(0)} KB`;
  return `${bytes} B`;
}


function mergeCacheItems(groups: HistoryCacheItem[][]): HistoryCacheItem[] {
  const items = new Map<string, HistoryCacheItem>();
  for (const group of groups) {
    for (const item of group) {
      const prev = items.get(item.date);
      items.set(item.date, {
        date: item.date,
        etfCount: Math.max(prev?.etfCount ?? 0, item.etfCount),
        savedAt: Math.max(prev?.savedAt ?? 0, item.savedAt),
        sizeBytes: Math.max(prev?.sizeBytes ?? 0, item.sizeBytes),
      });
    }
  }
  return [...items.values()].sort((a, b) => b.date.localeCompare(a.date));
}

export function HistorySettings() {
  const [refreshMode, setRefreshMode] = useRefreshMode();
  const [refreshIntervalMs, setRefreshIntervalMs] = useRefreshInterval();
  const [items, setItems] = useState<HistoryCacheItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [confirmAll, setConfirmAll] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const clientItems = await listClientHistoryCache().catch(() => [] as HistoryCacheItem[]);
      let serverItems: HistoryCacheItem[] = [];
      try {
        const res = await fetch("/api/history/cache", { cache: "no-store" });
        const body = await res.json();
        if (res.ok && Array.isArray(body.items)) serverItems = body.items as HistoryCacheItem[];
      } catch {
        /* Vercel 等环境可能没有可读的服务端文件缓存 */
      }
      setItems(mergeCacheItems([clientItems, serverItems]));
      setSelected(new Set());
      setConfirmAll(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "无法读取历史缓存");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = (date: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected((prev) => (prev.size === items.length ? new Set() : new Set(items.map((x) => x.date))));
  };

  const removeDates = async (dates: string[]) => {
    setBusy(true);
    setError(null);
    try {
      for (const date of dates) {
        await deleteClientHistoryCache(date);
        try {
          const res = await fetch(`/api/history/cache?date=${encodeURIComponent(date)}`, { method: "DELETE" });
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body.error || `删除 ${date} 失败`);
          }
        } catch (err) {
          if (err instanceof Error && err.message.includes("删除")) throw err;
          /* 服务端没有该日期时忽略 */
        }
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败");
      setBusy(false);
    }
  };

  const removeAll = async () => {
    if (!confirmAll) {
      setConfirmAll(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await deleteAllClientHistoryCache();
      try {
        const res = await fetch("/api/history/cache?all=1", { method: "DELETE" });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || "全部删除失败");
        }
      } catch (err) {
        if (err instanceof Error && err.message === "全部删除失败") throw err;
        /* 服务端没有可删文件时忽略 */
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "全部删除失败");
      setBusy(false);
    }
  };

  return (
    <section className="px-3 py-4">
      <h2 className="text-sm font-medium">行情刷新</h2>
      <p className="mt-1 max-w-3xl text-xs leading-relaxed text-terminal-muted">
        仅对「今日市场」和「我的自选」生效。历史市场是收盘快照，不会自动刷新。偏好保存在本机浏览器中。
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
        <label className="flex items-center gap-2">
          <span className="text-terminal-muted">刷新方式</span>
          <select
            value={refreshMode}
            onChange={(e) => setRefreshMode(e.target.value as RefreshMode)}
            className="h-8 border border-terminal-border bg-terminal-panel px-2 text-sm"
          >
            <option value="manual">手动刷新</option>
            <option value="auto">自动刷新</option>
          </select>
        </label>
        {refreshMode === "auto" ? (
          <label className="flex items-center gap-2">
            <span className="text-terminal-muted">自动刷新间隔</span>
            <select
              value={refreshIntervalMs}
              onChange={(e) => setRefreshIntervalMs(Number(e.target.value))}
              className="h-8 border border-terminal-border bg-terminal-panel px-2 text-sm"
            >
              {REFRESH_INTERVAL_OPTIONS.map((opt) => (
                <option key={opt.ms} value={opt.ms}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <span className="text-terminal-muted">可在行情信息栏点击「刷新」手动更新，不会倒计时轮询。</span>
        )}
      </div>

      <h2 className="mt-8 text-sm font-medium">历史行情缓存</h2>
      <p className="mt-1 max-w-3xl text-xs leading-relaxed text-terminal-muted">
        在「历史市场」里选过的交易日，收盘行情会保存在本机浏览器中，同一天再次打开会直接读取，不用重新拉日 K。下面列出已缓存的日期，可勾选删除，或一次性全部清除。服务端文件缓存只在有持久磁盘的环境生效；当前线上部署没有持久磁盘，因此以本机缓存为准。
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading || busy}
          className="border border-terminal-border px-2 py-0.5 text-xs disabled:opacity-40"
        >
          刷新列表
        </button>
        <button
          type="button"
          onClick={() => void removeDates([...selected])}
          disabled={busy || selected.size === 0}
          className="border border-terminal-border px-2 py-0.5 text-xs disabled:opacity-40"
        >
          删除所选{selected.size ? `（${selected.size}）` : ""}
        </button>
        <button
          type="button"
          onClick={() => void removeAll()}
          disabled={busy || items.length === 0}
          className="border border-up/40 px-2 py-0.5 text-xs text-up disabled:opacity-40"
        >
          {confirmAll ? "再点一次确认全部删除" : "全部删除"}
        </button>
      </div>
      {error ? <div className="mt-3 text-sm text-up">操作失败：{error}</div> : null}
      {loading ? (
        <div className="mt-6 text-sm text-terminal-muted">正在读取缓存…</div>
      ) : items.length === 0 ? (
        <div className="mt-6 text-sm text-terminal-muted">暂无已缓存的历史行情。到「历史市场」选择一个交易日后，这里会出现对应日期。</div>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-[640px] text-sm">
            <thead>
              <tr className="text-left text-terminal-muted">
                <th className="w-8 border-b border-terminal-border px-2 py-1 font-medium">
                  <input type="checkbox" checked={selected.size === items.length && items.length > 0} onChange={toggleAll} />
                </th>
                <th className="border-b border-terminal-border px-2 py-1 font-medium">收盘日期</th>
                <th className="border-b border-terminal-border px-2 py-1 font-medium text-right">品种数</th>
                <th className="border-b border-terminal-border px-2 py-1 font-medium text-right">占用空间</th>
                <th className="border-b border-terminal-border px-2 py-1 font-medium">写入时间</th>
                <th className="border-b border-terminal-border px-2 py-1 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.date} className="odd:bg-white/[0.015]">
                  <td className="px-2 py-1">
                    <input type="checkbox" checked={selected.has(item.date)} onChange={() => toggle(item.date)} />
                  </td>
                  <td className="px-2 py-1 font-mono">{item.date}</td>
                  <td className="px-2 py-1 text-right font-mono">{item.etfCount}</td>
                  <td className="px-2 py-1 text-right font-mono">{formatSize(item.sizeBytes)}</td>
                  <td className="px-2 py-1 font-mono text-terminal-muted">{formatShanghai(item.savedAt)}</td>
                  <td className="px-2 py-1 text-right">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void removeDates([item.date])}
                      className="text-xs text-terminal-muted hover:text-up disabled:opacity-40"
                    >
                      删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
