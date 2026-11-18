"use client";

import { useCallback, useEffect, useState } from "react";
import { formatShanghai } from "@/lib/format";
import { deleteAllClientHistoryCache, deleteClientHistoryCache } from "@/lib/client/prev-close-cache";
import type { HistoryCacheItem } from "@/lib/types";

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(0)} KB`;
  return `${bytes} B`;
}

export function HistorySettings() {
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
      const res = await fetch("/api/history/cache", { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "无法读取历史缓存");
      setItems(Array.isArray(body.items) ? body.items : []);
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
        const res = await fetch(`/api/history/cache?date=${encodeURIComponent(date)}`, { method: "DELETE" });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || `删除 ${date} 失败`);
        await deleteClientHistoryCache(date);
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
      const res = await fetch("/api/history/cache?all=1", { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "全部删除失败");
      await deleteAllClientHistoryCache();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "全部删除失败");
      setBusy(false);
    }
  };

  return (
    <section className="px-3 py-4">
      <h2 className="text-sm font-medium">历史行情缓存</h2>
      <p className="mt-1 max-w-3xl text-xs leading-relaxed text-terminal-muted">
        在「历史市场」里选过的交易日，收盘行情会下载并保存在服务端本地，同一天再次打开会直接读取，不用重新拉日 K。下面列出当前服务端已缓存的日期，可勾选删除，或一次性全部清除。若部署环境没有持久磁盘，进程重启后可能需要重新下载。
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
        <div className="mt-6 text-sm text-terminal-muted">正在读取服务端缓存…</div>
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
