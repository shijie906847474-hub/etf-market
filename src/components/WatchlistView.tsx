"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { changeClass, formatMoney, formatPct, formatPrice, formatShanghai } from "@/lib/format";
import type { EtfRow, MarketPayload } from "@/lib/types";
import { loadWatchlist, saveWatchlist, type WatchGroup } from "@/lib/watchlist";
import { cn } from "@/lib/cn";

export function WatchlistView() {
  const [groups, setGroups] = useState<WatchGroup[]>([]);
  const [active, setActive] = useState("default");
  const [data, setData] = useState<MarketPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");

  useEffect(() => {
    setGroups(loadWatchlist());
    (async () => {
      try {
        const res = await fetch("/api/market", { cache: "no-store" });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "行情加载失败");
        setData(json);
      } catch (err) {
        setError(err instanceof Error ? err.message : "行情加载失败");
      }
    })();
    const id = window.setInterval(async () => {
      const res = await fetch("/api/market", { cache: "no-store" });
      if (res.ok) setData(await res.json());
    }, 15000);
    return () => window.clearInterval(id);
  }, []);

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
      <header className="border-b border-terminal-border bg-terminal-header px-3 py-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-sm text-terminal-muted hover:text-terminal-text">
              ← 全市场
            </Link>
            <h1 className="text-sm font-semibold">我的自选</h1>
          </div>
          <div className="text-[11px] text-terminal-muted">
            本地保存，无需登录 · 数据来源：{data?.source ?? "东方财富公开行情"} · {formatShanghai(data?.quoteTime ?? null)}
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

      <div className="overflow-auto">
        <table className="min-w-full text-sm">
          <thead className="sticky top-0 bg-terminal-header">
            <tr className="text-left text-terminal-muted">
              <th className="px-2 py-1">排序</th>
              <th className="px-2 py-1">代码</th>
              <th className="px-2 py-1">名称</th>
              <th className="px-2 py-1 text-right">最新价</th>
              <th className="px-2 py-1 text-right">涨跌幅</th>
              <th className="px-2 py-1 text-right">成交额</th>
              <th className="px-2 py-1">操作</th>
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
                  <td className="px-2 py-1 font-mono">
                    {row ? (
                      <Link href={`/etf/${row.code}?market=${row.market}`} className="hover:underline">
                        {code}
                      </Link>
                    ) : (
                      code
                    )}
                  </td>
                  <td className="px-2 py-1">
                    {row ? (
                      <Link href={`/etf/${row.code}?market=${row.market}`} className="hover:underline">
                        {row.name}
                      </Link>
                    ) : (
                      <span className="text-terminal-muted">{data ? "清单中未找到" : "行情加载中"}</span>
                    )}
                  </td>
                  <td className={cn("px-2 py-1 text-right font-mono", changeClass(row?.changePct ?? null))}>
                    {formatPrice(row?.last ?? null)}
                  </td>
                  <td className={cn("px-2 py-1 text-right font-mono", changeClass(row?.changePct ?? null))}>
                    {formatPct(row?.changePct ?? null)}
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
