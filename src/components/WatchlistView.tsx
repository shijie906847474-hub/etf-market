"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { changeClass, formatMoney, formatPct, formatPrice, formatShanghai, lastPriceLabel } from "@/lib/format";
import type { EtfRow, MarketPayload } from "@/lib/types";
import { loadWatchlist, saveWatchlist, type WatchGroup } from "@/lib/watchlist";
import { cn } from "@/lib/cn";
import { readLiveMarketCache, writeLiveMarketCache } from "@/lib/client/live-market-cache";
import { useRefreshInterval, useRefreshMode } from "@/lib/client/refresh-interval";

export function WatchlistView() {
  const [groups, setGroups] = useState<WatchGroup[]>([]);
  const [active, setActive] = useState("default");
  const [data, setData] = useState<MarketPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [newName, setNewName] = useState("");
  const [refreshIntervalMs] = useRefreshInterval();
  const [refreshMode] = useRefreshMode();
  const refreshIntervalRef = useRef(refreshIntervalMs);
  const refreshModeRef = useRef(refreshMode);
  refreshIntervalRef.current = refreshIntervalMs;
  refreshModeRef.current = refreshMode;
  const [nextRefreshAt, setNextRefreshAt] = useState<number | null>(null);
  const [nowTick, setNowTick] = useState(0);
  const headerRef = useRef<HTMLElement>(null);
  const [headerOffset, setHeaderOffset] = useState(0);

  useLayoutEffect(() => {
    const cached = readLiveMarketCache();
    if (cached) setData(cached);
  }, []);

  useLayoutEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const update = () => setHeaderOffset(el.getBoundingClientRect().height);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (refreshMode !== "auto") return;
    setNowTick(Date.now());
    const id = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [refreshMode]);

  const load = useCallback(async (silent: boolean) => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/market", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "行情加载失败");
      setData(json);
      writeLiveMarketCache(json);
      setError(null);
    } catch (err) {
      if (!silent) setError(err instanceof Error ? err.message : "行情加载失败");
    } finally {
      setRefreshing(false);
      if (refreshModeRef.current === "auto") {
        setNextRefreshAt(Date.now() + refreshIntervalRef.current);
      } else {
        setNextRefreshAt(null);
      }
    }
  }, []);

  useEffect(() => {
    setGroups(loadWatchlist());
    void load(Boolean(readLiveMarketCache()));
  }, [load]);

  useEffect(() => {
    if (refreshMode !== "auto") {
      setNextRefreshAt(null);
      return;
    }
    setNextRefreshAt(Date.now() + refreshIntervalMs);
    const id = window.setInterval(() => void load(true), refreshIntervalMs);
    return () => window.clearInterval(id);
  }, [refreshMode, refreshIntervalMs, load]);

  const persist = (next: WatchGroup[]) => {
    setGroups(next);
    saveWatchlist(next);
  };

  const map = useMemo(() => {
    const m = new Map<string, EtfRow>();
    data?.list.forEach((r) => m.set(r.code, r));
    return m;
  }, [data]);

  const group = groups.find((g) => g.id === active) ?? groups[0];
  return (
    <div className="min-h-screen">
      <header ref={headerRef} className="sticky top-0 z-30 border-b border-terminal-border bg-terminal-header px-3 py-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-sm text-terminal-muted hover:text-terminal-text">
              ← 全市场
            </Link>
            <h1 className="text-sm font-semibold">我的自选</h1>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-terminal-muted">
            <span>
              本地保存，无需登录 · 数据来源：{data?.source ?? "东方财富公开行情"} · {formatShanghai(data?.quoteTime ?? null)}
              {refreshing
                ? " · 正在刷新"
                : refreshMode === "auto" && nextRefreshAt != null
                  ? ` · 刷新倒计时 ${Math.max(0, Math.ceil((nextRefreshAt - (nowTick || Date.now())) / 1000))} 秒`
                  : ""}
            </span>
            {refreshMode === "manual" ? (
              <button
                type="button"
                onClick={() => void load(Boolean(data))}
                disabled={refreshing}
                className="border border-terminal-border px-2 py-0.5 text-[11px] text-terminal-text disabled:opacity-40"
              >
                {refreshing ? "正在刷新" : "刷新"}
              </button>
            ) : null}
          </div>
        </div>
      </header>

      {error ? <div className="m-3 border border-up/40 bg-up/10 px-3 py-2 text-sm text-up">{error}</div> : null}

      <section className="flex flex-wrap items-center gap-2 border-b border-terminal-border px-3 py-2">
        {groups.map((g) => (
          <button
            key={g.id}
            type="button"
            onClick={() => setActive(g.id)}
            className={cn("border border-terminal-border px-2 py-1 text-sm", g.id === group?.id && "bg-white/10")}
          >
            {g.name} ({g.codes.length})
          </button>
        ))}
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="新分组名称"
          className="h-8 border border-terminal-border bg-terminal-panel px-2 text-sm"
        />
        <button
          type="button"
          className="h-8 border border-terminal-border px-2 text-sm"
          onClick={() => {
            const name = newName.trim();
            if (!name) return;
            const id = `g-${Date.now()}`;
            persist([...groups, { id, name, codes: [] }]);
            setActive(id);
            setNewName("");
          }}
        >
          新建分组
        </button>
        {group && group.id !== "default" ? (
          <button
            type="button"
            className="h-8 border border-terminal-border px-2 text-sm text-up"
            onClick={() => {
              const next = groups.filter((g) => g.id !== group.id);
              persist(next.length ? next : [{ id: "default", name: "默认分组", codes: [] }]);
              setActive(next[0]?.id ?? "default");
            }}
          >
            删除当前分组
          </button>
        ) : null}
      </section>

      <div>
        <table className="min-w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr className="text-left text-terminal-muted">
              {["排序", "代码", "名称", "最新价", "涨跌幅", "成交额", "操作"].map((label) => (
                <th
                  key={label}
                  className={cn(
                    "sticky z-20 border-b border-terminal-border bg-terminal-header px-2 py-1",
                    (label === "最新价" || label === "涨跌幅" || label === "成交额") && "text-right",
                  )}
                  style={{ top: headerOffset }}
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!group?.codes.length ? (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-terminal-muted">
                  当前分组还没有自选。可在全市场列表中点击星标添加。
                </td>
              </tr>
            ) : null}
            {group?.codes.map((code, idx) => {
              const row = map.get(code);
              return (
                <tr key={code} className="odd:bg-white/[0.015]">
                  <td className="px-2 py-1">
                    <button
                      type="button"
                      disabled={idx === 0}
                      className="mr-1 border border-terminal-border px-1 disabled:opacity-30"
                      onClick={() => {
                        const codes = [...group.codes];
                        [codes[idx - 1], codes[idx]] = [codes[idx], codes[idx - 1]];
                        persist(groups.map((g) => (g.id === group.id ? { ...g, codes } : g)));
                      }}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      disabled={idx === group.codes.length - 1}
                      className="border border-terminal-border px-1 disabled:opacity-30"
                      onClick={() => {
                        const codes = [...group.codes];
                        [codes[idx + 1], codes[idx]] = [codes[idx], codes[idx + 1]];
                        persist(groups.map((g) => (g.id === group.id ? { ...g, codes } : g)));
                      }}
                    >
                      ↓
                    </button>
                  </td>
                  <td className="px-2 py-1 font-mono">{code}</td>
                  <td className="px-2 py-1">
                    {row ? row.name : <span className="text-terminal-muted">{data ? "清单中未找到" : "行情加载中"}</span>}
                  </td>
                  <td
                    className={cn(
                      "px-2 py-1 text-right font-mono",
                      row && row.status !== "正常上市" ? "text-terminal-muted" : changeClass(row?.changePct ?? null),
                    )}
                  >
                    {row ? lastPriceLabel(row) : "—"}
                  </td>
                  <td
                    className={cn(
                      "px-2 py-1 text-right font-mono",
                      row && row.status !== "正常上市" ? "text-terminal-muted" : changeClass(row?.changePct ?? null),
                    )}
                  >
                    {row && row.status !== "正常上市" ? row.status : formatPct(row?.changePct ?? null)}
                  </td>
                  <td className="px-2 py-1 text-right font-mono">{formatMoney(row?.turnover ?? null)}</td>
                  <td className="px-2 py-1">
                    <button
                      type="button"
                      className="text-terminal-muted hover:text-up"
                      onClick={() =>
                        persist(groups.map((g) => (g.id === group.id ? { ...g, codes: g.codes.filter((c) => c !== code) } : g)))
                      }
                    >
                      移除
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="px-3 py-3 text-[11px] text-terminal-muted">自选仅保存在本浏览器 localStorage，刷新行情不会改动手动排序。</p>
    </div>
  );
}
