"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { COLUMNS, DEFAULT_VISIBLE, type ColumnKey } from "@/components/columns";
import { isPrevCloseCacheFresh, readPrevCloseCache, writePrevCloseCache } from "@/lib/client/prev-close-cache";
import { changeClass, csvEscape, formatAum, formatDateOnly, formatMoney, formatNumber, formatPct, formatPrice, formatShanghai, formatVolumeHands } from "@/lib/format";
import { shanghaiDateString } from "@/lib/market-hours";
import type { EtfCategory, EtfRow, MarketPayload } from "@/lib/types";
import { ALL_CATEGORIES } from "@/lib/types";
import { isWatched, loadWatchlist, saveWatchlist, toggleWatch, type WatchGroup } from "@/lib/watchlist";
import { cn } from "@/lib/cn";

type MarketView = "today" | "prev";
const COLUMN_STORE_KEY = "etf-market-columns-v2";
const COLUMN_STORE_LEGACY = "etf-market-columns-v1";

function migrateVisible(saved: ColumnKey[]): ColumnKey[] {
  const next = [...saved];
  const insertAfter = (key: ColumnKey, after: ColumnKey) => {
    if (next.includes(key)) return;
    const i = next.indexOf(after);
    if (i >= 0) next.splice(i + 1, 0, key);
    else next.push(key);
  };
  insertAfter("ytdChangePct", "aum");
  insertAfter("managementFee", "ytdChangePct");
  return next;
}

function loadVisibleColumns(): ColumnKey[] {
  try {
    const v2 = localStorage.getItem(COLUMN_STORE_KEY);
    if (v2) return JSON.parse(v2) as ColumnKey[];
    const v1 = localStorage.getItem(COLUMN_STORE_LEGACY);
    if (v1) {
      const migrated = migrateVisible(JSON.parse(v1) as ColumnKey[]);
      localStorage.setItem(COLUMN_STORE_KEY, JSON.stringify(migrated));
      return migrated;
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_VISIBLE;
}

type SortDir = "asc" | "desc";

interface Filters {
  search: string;
  category: "全部" | EtfCategory;
  changeBucket: string;
  premiumBucket: string;
  turnoverMin: string;
  turnoverMax: string;
  aumMin: string;
  aumMax: string;
  ret5Min: string;
  ret5Max: string;
  ret20Min: string;
  ret20Max: string;
  turnoverRateMin: string;
  turnoverRateMax: string;
  volumeRatioMin: string;
  volumeRatioMax: string;
  feeMin: string;
  feeMax: string;
}

const EMPTY_FILTERS: Filters = {
  search: "",
  category: "全部",
  changeBucket: "",
  premiumBucket: "",
  turnoverMin: "",
  turnoverMax: "",
  aumMin: "",
  aumMax: "",
  ret5Min: "",
  ret5Max: "",
  ret20Min: "",
  ret20Max: "",
  turnoverRateMin: "",
  turnoverRateMax: "",
  volumeRatioMin: "",
  volumeRatioMax: "",
  feeMin: "",
  feeMax: "",
};

function numOrNull(s: string): number | null {
  if (s.trim() === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function inRange(value: number | null, min: number | null, max: number | null): boolean {
  if (min === null && max === null) return true;
  if (value === null) return false;
  if (min !== null && value < min) return false;
  if (max !== null && value > max) return false;
  return true;
}

function matchChange(v: number | null, bucket: string): boolean {
  if (!bucket) return true;
  if (v === null) return false;
  switch (bucket) {
    case "up5":
      return v > 5;
    case "up2to5":
      return v >= 2 && v <= 5;
    case "up0to2":
      return v >= 0 && v < 2;
    case "down0to2":
      return v < 0 && v > -2;
    case "down2to5":
      return v <= -2 && v >= -5;
    case "down5":
      return v < -5;
    default:
      return true;
  }
}

function matchPremium(v: number | null, bucket: string): boolean {
  if (!bucket) return true;
  if (v === null) return false;
  switch (bucket) {
    case "discount":
      return v < 0;
    case "p0to1":
      return v >= 0 && v < 1;
    case "p1to2":
      return v >= 1 && v < 2;
    case "p2to5":
      return v >= 2 && v < 5;
    case "p5":
      return v >= 5;
    default:
      return true;
  }
}

function cellValue(row: EtfRow, key: ColumnKey): string {
  switch (key) {
    case "code":
      return row.code;
    case "name":
      return row.name;
    case "exchange":
      return row.exchange === "SH" ? "上海" : "深圳";
    case "indexName":
      return row.indexName ?? "—";
    case "category":
      return row.category;
    case "last":
      return formatPrice(row.last);
    case "change":
      return formatPrice(row.change);
    case "changePct":
      return formatPct(row.changePct);
    case "turnover":
      return formatMoney(row.turnover);
    case "volume":
      return formatVolumeHands(row.volume);
    case "turnoverRate":
      return formatPct(row.turnoverRate);
    case "volumeRatio":
      return formatNumber(row.volumeRatio, 2);
    case "bid1":
      return formatPrice(row.bid1);
    case "ask1":
      return formatPrice(row.ask1);
    case "spread":
      return formatPrice(row.spread);
    case "iopv":
      return formatPrice(row.iopv);
    case "premiumPct":
      return formatPct(row.premiumPct);
    case "aum":
      return formatAum(row.aum);
    case "ytdChangePct":
      return formatPct(row.ytdChangePct);
    case "managementFee":
      return row.managementFee === null ? "—" : `${row.managementFee.toFixed(2)}%`;
    case "custodyFee":
      return row.custodyFee === null ? "—" : `${row.custodyFee.toFixed(2)}%`;
    case "foundDate":
      return formatDateOnly(row.foundDate);
    case "ret5d":
      return formatPct(row.ret5d);
    case "ret20d":
      return formatPct(row.ret20d);
    case "ret60d":
      return formatPct(row.ret60d);
    case "ret1y":
      return formatPct(row.ret1y);
    case "status":
      return row.status;
    default:
      return "—";
  }
}

function rawSort(row: EtfRow, key: ColumnKey): string | number | null {
  const v = row[key as keyof EtfRow];
  if (typeof v === "number" || typeof v === "string" || v === null) return v;
  return v === undefined ? null : String(v);
}

function HeaderStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="border-r border-terminal-border px-3 py-2 last:border-r-0 min-w-[120px]">
      <div className="text-[11px] text-terminal-muted">{label}</div>
      <div className="font-mono text-base tabular-nums">{value}</div>
      {sub ? <div className="text-[11px] text-terminal-muted">{sub}</div> : null}
    </div>
  );
}

export function MarketTerminal() {
  const [view, setView] = useState<MarketView>("today");
  const [liveData, setLiveData] = useState<MarketPayload | null>(null);
  const [prevData, setPrevData] = useState<MarketPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [sortKey, setSortKey] = useState<ColumnKey>("turnover");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [visible, setVisible] = useState<ColumnKey[]>(DEFAULT_VISIBLE);
  const [showCols, setShowCols] = useState(false);
  const [groups, setGroups] = useState<WatchGroup[]>([]);

  useEffect(() => {
    setGroups(loadWatchlist());
    setVisible(loadVisibleColumns());
  }, []);

  const persistCols = (next: ColumnKey[]) => {
    setVisible(next);
    localStorage.setItem(COLUMN_STORE_KEY, JSON.stringify(next));
  };

  const data = view === "prev" ? prevData : liveData;

  const loadLive = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch("/api/market", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "行情加载失败");
      setLiveData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "行情加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadPrev = useCallback(async () => {
    const today = shanghaiDateString();
    try {
      setError(null);
      const cached = await readPrevCloseCache();
      if (isPrevCloseCacheFresh(cached, today) && cached) {
        setPrevData(cached.payload);
        setLoading(false);
        return;
      }
      setLoading(true);
      const res = await fetch("/api/market?view=prev", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "上一交易日收盘快照加载失败");
      setPrevData(json);
      if (json?.asOfDate && Array.isArray(json.list)) {
        await writePrevCloseCache({
          asOfDate: json.asOfDate,
          shanghaiDate: today,
          savedAt: Date.now(),
          payload: json,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "上一交易日收盘快照加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  const load = useCallback(() => {
    return view === "prev" ? loadPrev() : loadLive();
  }, [view, loadPrev, loadLive]);

  useEffect(() => {
    setLoading(true);
    if (view === "today") {
      loadLive();
      const id = window.setInterval(loadLive, 15000);
      return () => window.clearInterval(id);
    }
    loadPrev();
    return undefined;
  }, [view, loadLive, loadPrev]);

  const updateFilter = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  };

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = filters.search.trim().toLowerCase();
    return data.list.filter((row) => {
      if (row.status === "终止上市") return false;
      if (filters.category !== "全部" && row.category !== filters.category) return false;
      if (q && !row.code.includes(q) && !row.name.toLowerCase().includes(q)) return false;
      if (!matchChange(row.changePct, filters.changeBucket)) return false;
      if (!matchPremium(row.premiumPct, filters.premiumBucket)) return false;
      if (!inRange(row.turnover === null ? null : row.turnover / 1e4, numOrNull(filters.turnoverMin), numOrNull(filters.turnoverMax)))
        return false;
      if (!inRange(row.aum === null ? null : row.aum / 1e8, numOrNull(filters.aumMin), numOrNull(filters.aumMax))) return false;
      if (!inRange(row.ret5d, numOrNull(filters.ret5Min), numOrNull(filters.ret5Max))) return false;
      if (!inRange(row.ret20d, numOrNull(filters.ret20Min), numOrNull(filters.ret20Max))) return false;
      if (!inRange(row.turnoverRate, numOrNull(filters.turnoverRateMin), numOrNull(filters.turnoverRateMax))) return false;
      if (!inRange(row.volumeRatio, numOrNull(filters.volumeRatioMin), numOrNull(filters.volumeRatioMax))) return false;
      if (!inRange(row.managementFee, numOrNull(filters.feeMin), numOrNull(filters.feeMax))) return false;
      return true;
    });
  }, [data, filters]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      const av = rawSort(a, sortKey);
      const bv = rawSort(b, sortKey);
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      if (typeof av === "number" && typeof bv === "number") return sortDir === "asc" ? av - bv : bv - av;
      const cmp = String(av).localeCompare(String(bv), "zh-CN");
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const pageRows = sorted.slice((page - 1) * pageSize, page * pageSize);

  const onSort = (key: ColumnKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(key === "name" || key === "code" || key === "indexName" ? "asc" : "desc");
    }
  };

  const exportCsv = () => {
    const cols = COLUMNS.filter((c) => visible.includes(c.key));
    const header = cols.map((c) => csvEscape(c.label)).join(",");
    const lines = sorted.map((row) => cols.map((c) => csvEscape(cellValue(row, c.key))).join(","));
    const blob = new Blob(["\uFEFF" + [header, ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `etf-market-${view === "prev" && data?.asOfDate ? data.asOfDate : new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const star = (code: string) => {
    const next = toggleWatch(groups, code);
    setGroups(next);
    saveWatchlist(next);
  };

  const ov = data?.overview;
  const totalForBar = (ov?.up ?? 0) + (ov?.down ?? 0) + (ov?.flat ?? 0) || 1;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-terminal-border bg-terminal-header/95 backdrop-blur-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
          <div className="flex items-center gap-4">
            <div className="text-sm font-semibold tracking-wide">ETF MARKET</div>
            <div className="text-xs text-terminal-muted">中国沪深场内 ETF 全市场监控终端 V1.0</div>
          </div>
          <nav className="flex items-center gap-3 text-sm">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setView("prev")}
                className={cn(
                  "rounded border px-2 py-0.5 text-xs",
                  view === "prev"
                    ? "border-terminal-text text-terminal-text"
                    : "border-transparent text-terminal-muted hover:text-terminal-text",
                )}
              >
                上一日
              </button>
              <button
                type="button"
                onClick={() => setView("today")}
                className={cn(
                  "rounded border px-2 py-0.5 text-xs",
                  view === "today"
                    ? "border-terminal-text text-terminal-text"
                    : "border-transparent text-terminal-muted hover:text-terminal-text",
                )}
              >
                今日市场
              </button>
            </div>
            <Link href="/watchlist" className="text-terminal-muted hover:text-terminal-text">
              我的自选
            </Link>
            <button type="button" onClick={() => void load()} className="rounded border border-terminal-border px-2 py-0.5 text-xs text-terminal-muted hover:text-terminal-text">
              刷新
            </button>
          </nav>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-terminal-border px-3 py-1 text-[11px] text-terminal-muted">
          <span>数据来源：{data?.source ?? "东方财富公开行情"}</span>
          {view === "prev" ? (
            <>
              <span>收盘日期 {data?.asOfDate ?? "—"}</span>
              <span>上一交易日收盘（本地缓存，非实时行情）</span>
            </>
          ) : (
            <>
              <span>行情时间：{formatShanghai(data?.quoteTime ?? null)}</span>
              <span>{data?.delayed ? "可能延迟，非正式交易所专线" : data ? "当前按日终/非交易时段展示" : ""}</span>
            </>
          )}
          <span>页面拉取：{formatShanghai(data?.fetchedAt ?? null)}</span>
          <span>状态：{error ? "接口异常" : data?.freshness ?? (loading ? "加载中" : "—")}</span>
          {data ? (
            <span>
              {view === "prev"
                ? `资料覆盖 ${data.f10Coverage}/${data.list.length} · 折溢价/IOPV 不适用于收盘快照`
                : `资料覆盖 ${data.f10Coverage}/${data.list.length} · IOPV 覆盖 ${data.iopvCoverage}/${data.list.length}`}
            </span>
          ) : null}
        </div>
      </header>

      {error ? (
        <div className="m-3 border border-up/40 bg-up/10 px-3 py-2 text-sm text-up">加载失败：{error}。页面不会用模拟数据替代真实行情。</div>
      ) : null}
      {loading && !data ? (
        <div className="px-3 py-10 text-sm text-terminal-muted">
          {view === "prev"
            ? "正在构建上一交易日收盘快照。首次需按代码拉取日 K，可能需要一两分钟；完成后会写入本地缓存，之后打开该交易日无需再请求。"
            : "正在从服务端拉取沪深场内 ETF 全量行情…"}
        </div>
      ) : null}

      {ov ? (
        <>
          <section className="flex flex-wrap border-b border-terminal-border">
            <HeaderStat label="ETF 数量" value={String(ov.totalCount)} sub={`正常上市 ${ov.listedCount}${ov.noQuoteCount ? ` · 无行情 ${ov.noQuoteCount}` : ""}${ov.pausedCount ? ` · 暂停 ${ov.pausedCount}` : ""}`} />
            <HeaderStat
              label="总规模（已披露）"
              value={formatAum(ov.totalAum)}
              sub={`覆盖 ${ov.aumCoverage} 只，取 F10 NEW_SCALE`}
            />
            <HeaderStat label="总成交额" value={formatMoney(ov.totalTurnover)} sub="不等于资金净流入" />
            <HeaderStat label="上涨" value={String(ov.up)} />
            <HeaderStat label="下跌" value={String(ov.down)} />
            <HeaderStat label="平盘" value={String(ov.flat)} />
            <div className="min-w-[220px] flex-1 px-3 py-2">
              <div className="text-[11px] text-terminal-muted">涨跌分布</div>
              <div className="mt-1 flex h-2 overflow-hidden bg-terminal-panel">
                <div className="bg-up" style={{ width: `${(ov.up / totalForBar) * 100}%` }} />
                <div className="bg-flat" style={{ width: `${(ov.flat / totalForBar) * 100}%` }} />
                <div className="bg-down" style={{ width: `${(ov.down / totalForBar) * 100}%` }} />
              </div>
              <div className="mt-1 font-mono text-[11px] text-terminal-muted">
                {((ov.up / totalForBar) * 100).toFixed(1)}% / {((ov.flat / totalForBar) * 100).toFixed(1)}% / {((ov.down / totalForBar) * 100).toFixed(1)}%
              </div>
            </div>
          </section>

          <section className="grid grid-cols-1 gap-0 border-b border-terminal-border lg:grid-cols-4">
            <RankList title="涨幅榜 TOP 5" rows={ov.topGainers} field="changePct" />
            <RankList title="跌幅榜 TOP 5" rows={ov.topLosers} field="changePct" />
            <RankList title="成交额榜 TOP 5" rows={ov.topTurnover} field="turnover" />
            <div className="border-r border-terminal-border last:border-r-0 px-3 py-2">
              <div className="mb-1 text-[12px] text-terminal-muted">{view === "prev" ? "收盘日市场热点分类" : "当日市场热点分类"}</div>
              <div className="text-[10px] text-terminal-muted mb-1">按分类成交额加权涨跌幅排序</div>
              {ov.hotspots.map((h) => (
                <button
                  key={h.category}
                  type="button"
                  onClick={() => updateFilter("category", h.category)}
                  className="flex w-full items-center justify-between py-0.5 text-left text-sm hover:bg-white/5"
                >
                  <span>
                    {h.category} <span className="text-[11px] text-terminal-muted">{h.count}只</span>
                  </span>
                  <span className={cn("font-mono", changeClass(h.weightedReturn))}>{formatPct(h.weightedReturn)}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="overflow-x-auto border-b border-terminal-border">
            <div className="flex min-w-[980px]">
              {(data?.categories ?? []).map((c) => (
                <button
                  key={c.category}
                  type="button"
                  onClick={() => updateFilter("category", filters.category === c.category ? "全部" : c.category)}
                  className={cn(
                    "min-w-[122px] flex-1 border-r border-terminal-border px-2 py-2 text-left last:border-r-0 hover:bg-white/5",
                    filters.category === c.category && "bg-white/10",
                  )}
                >
                  <div className="text-[12px]">{c.category}</div>
                  <div className="font-mono text-xs text-terminal-muted">{c.count} 只</div>
                  <div className={cn("font-mono text-sm", changeClass(c.weightedReturn))}>{formatPct(c.weightedReturn)}</div>
                  <div className="font-mono text-[11px] text-terminal-muted">{formatMoney(c.turnover)}</div>
                  <div className="text-[10px] text-terminal-muted">
                    <span className="text-up">{c.up}</span>/<span className="text-flat">{c.flat}</span>/
                    <span className="text-down">{c.down}</span>
                  </div>
                  <div className="mt-1 truncate text-[10px] text-terminal-muted">
                    {c.representatives.map((r) => r.name.replace("ETF", "")).join(" · ") || "—"}
                  </div>
                </button>
              ))}
            </div>
            <div className="px-3 py-1 text-[10px] text-terminal-muted">分类涨跌幅为成交额加权；分类依据 F10 基金类型与跟踪指数，缺失资料暂归「其他」。</div>
          </section>
        </>
      ) : null}

      <section className="border-b border-terminal-border px-3 py-2">
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs">
            <span className="mb-1 block text-terminal-muted">搜索代码/名称</span>
            <input
              value={filters.search}
              onChange={(e) => updateFilter("search", e.target.value)}
              className="h-8 w-40 border border-terminal-border bg-terminal-panel px-2 font-mono text-sm"
            />
          </label>
          <Select label="类型" value={filters.category} onChange={(v) => updateFilter("category", v as Filters["category"])} options={["全部", ...ALL_CATEGORIES]} />
          <Select
            label="涨跌幅"
            value={filters.changeBucket}
            onChange={(v) => updateFilter("changeBucket", v)}
            options={[
              ["", "全部"],
              ["up5", "涨幅超过 5%"],
              ["up2to5", "涨幅 2%～5%"],
              ["up0to2", "涨幅 0%～2%"],
              ["down0to2", "跌幅 0%～2%"],
              ["down2to5", "跌幅 2%～5%"],
              ["down5", "跌幅超过 5%"],
            ]}
          />
          <Select
            label="折溢价"
            value={filters.premiumBucket}
            onChange={(v) => updateFilter("premiumBucket", v)}
            options={[
              ["", "全部"],
              ["discount", "折价"],
              ["p0to1", "溢价 0%～1%"],
              ["p1to2", "溢价 1%～2%"],
              ["p2to5", "溢价 2%～5%"],
              ["p5", "溢价超过 5%"],
            ]}
          />
          <Range label="成交额(万)" a={filters.turnoverMin} b={filters.turnoverMax} onA={(v) => updateFilter("turnoverMin", v)} onB={(v) => updateFilter("turnoverMax", v)} />
          <Range label="规模(亿)" a={filters.aumMin} b={filters.aumMax} onA={(v) => updateFilter("aumMin", v)} onB={(v) => updateFilter("aumMax", v)} />
          <Range label="近5日涨幅%" a={filters.ret5Min} b={filters.ret5Max} onA={(v) => updateFilter("ret5Min", v)} onB={(v) => updateFilter("ret5Max", v)} />
          <Range label="近20日涨幅%" a={filters.ret20Min} b={filters.ret20Max} onA={(v) => updateFilter("ret20Min", v)} onB={(v) => updateFilter("ret20Max", v)} />
          <Range label="换手率%" a={filters.turnoverRateMin} b={filters.turnoverRateMax} onA={(v) => updateFilter("turnoverRateMin", v)} onB={(v) => updateFilter("turnoverRateMax", v)} />
          <Range label="量比" a={filters.volumeRatioMin} b={filters.volumeRatioMax} onA={(v) => updateFilter("volumeRatioMin", v)} onB={(v) => updateFilter("volumeRatioMax", v)} />
          <Range label="管理费率%" a={filters.feeMin} b={filters.feeMax} onA={(v) => updateFilter("feeMin", v)} onB={(v) => updateFilter("feeMax", v)} />
          <button
            type="button"
            onClick={() => {
              setFilters(EMPTY_FILTERS);
              setPage(1);
            }}
            className="h-8 border border-terminal-border px-2 text-xs text-terminal-muted hover:text-terminal-text"
          >
            清空筛选
          </button>
          <div className="relative">
            <button type="button" onClick={() => setShowCols((v) => !v)} className="h-8 border border-terminal-border px-2 text-xs">
              显示列
            </button>
            {showCols ? (
              <div className="absolute right-0 z-20 mt-1 max-h-80 w-48 overflow-auto border border-terminal-border bg-terminal-panel p-2 text-xs shadow-xl">
                {COLUMNS.map((c) => (
                  <label key={c.key} className="flex items-center gap-2 py-0.5">
                    <input
                      type="checkbox"
                      checked={visible.includes(c.key)}
                      onChange={(e) => {
                        const next = e.target.checked ? [...visible, c.key] : visible.filter((k) => k !== c.key);
                        if (next.length) persistCols(next);
                      }}
                    />
                    {c.label}
                  </label>
                ))}
              </div>
            ) : null}
          </div>
          <button type="button" onClick={exportCsv} className="h-8 border border-terminal-border px-2 text-xs">
            导出 CSV
          </button>
        </div>
      </section>

      <section className="px-0">
        <div className="flex items-center justify-between px-3 py-1 text-[11px] text-terminal-muted">
          <span>
            当前筛选 {sorted.length} 只 / 全市场 {data?.list.length ?? 0} 只 · 默认按成交额降序 · 成交量单位为手（1 手 = 100 份）
          </span>
          <label>
            每页
            <select
              className="ml-1 border border-terminal-border bg-terminal-panel px-1"
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
            >
              {[20, 50, 100, 200].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="max-h-[70vh] overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 z-10 bg-terminal-header">
              <tr>
                <th className="w-8 border-b border-terminal-border px-1 py-1 text-left font-medium text-terminal-muted">自选</th>
                {COLUMNS.filter((c) => visible.includes(c.key)).map((c) => (
                  <th
                    key={c.key}
                    onClick={() => onSort(c.key)}
                    className={cn(
                      "cursor-pointer whitespace-nowrap border-b border-terminal-border px-2 py-1 font-medium text-terminal-muted hover:text-terminal-text",
                      c.align === "right" ? "text-right" : "text-left",
                    )}
                  >
                    {c.label}
                    {sortKey === c.key ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRows.length === 0 && !loading ? (
                <tr>
                  <td colSpan={visible.length + 1} className="px-3 py-8 text-center text-terminal-muted">
                    无符合条件的 ETF
                  </td>
                </tr>
              ) : null}
              {pageRows.map((row) => (
                <tr key={row.secid} className="odd:bg-white/[0.015] hover:bg-white/[0.04]">
                  <td className="px-1 py-1 text-center">
                    <button type="button" onClick={() => star(row.code)} className={isWatched(groups, row.code) ? "text-up" : "text-terminal-muted"}>
                      {isWatched(groups, row.code) ? "★" : "☆"}
                    </button>
                  </td>
                  {COLUMNS.filter((c) => visible.includes(c.key)).map((c) => {
                    const colored = ["change", "changePct", "premiumPct", "ret5d", "ret20d", "ret60d", "ret1y", "ytdChangePct"].includes(c.key);
                    const href = `/etf/${row.code}?market=${row.market}`;
                    const inner = (
                      <span className={cn(c.numeric && "font-mono tabular-nums", colored && changeClass(row[c.key] as number | null))}>
                        {cellValue(row, c.key)}
                        {c.key === "aum" && row.aumDate ? (
                          <span className="ml-1 text-[10px] text-terminal-muted">{row.aumDate}</span>
                        ) : null}
                      </span>
                    );
                    return (
                      <td key={c.key} className={cn("whitespace-nowrap px-2 py-1", c.align === "right" && "text-right")}>
                        {c.key === "code" || c.key === "name" ? (
                          <Link href={href} className="hover:underline">
                            {inner}
                          </Link>
                        ) : (
                          inner
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between px-3 py-2 text-xs text-terminal-muted">
          <span>
            第 {page} / {pageCount} 页
          </span>
          <div className="flex gap-2">
            <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="border border-terminal-border px-2 py-0.5 disabled:opacity-40">
              上一页
            </button>
            <button type="button" disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)} className="border border-terminal-border px-2 py-0.5 disabled:opacity-40">
              下一页
            </button>
          </div>
        </div>
      </section>

      <footer className="border-t border-terminal-border px-3 py-3 text-[11px] leading-relaxed text-terminal-muted">
        {(data?.notes ?? []).map((n) => (
          <div key={n}>{n}</div>
        ))}
      </footer>
    </div>
  );
}

function RankList({ title, rows, field }: { title: string; rows: EtfRow[]; field: "changePct" | "turnover" }) {
  return (
    <div className="border-r border-terminal-border px-3 py-2 last:border-r-0">
      <div className="mb-1 text-[12px] text-terminal-muted">{title}</div>
      {rows.map((row, i) => (
        <Link key={row.code} href={`/etf/${row.code}?market=${row.market}`} className="flex items-center justify-between py-0.5 text-sm hover:bg-white/5">
          <span className="truncate">
            <span className="mr-2 font-mono text-terminal-muted">{i + 1}</span>
            {row.name}
          </span>
          <span className={cn("ml-2 font-mono", field === "changePct" ? changeClass(row.changePct) : "text-terminal-text")}>
            {field === "changePct" ? formatPct(row.changePct) : formatMoney(row.turnover)}
          </span>
        </Link>
      ))}
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<string | [string, string]>;
}) {
  return (
    <label className="text-xs">
      <span className="mb-1 block text-terminal-muted">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="h-8 border border-terminal-border bg-terminal-panel px-1 text-sm">
        {options.map((opt) => {
          const [v, l] = typeof opt === "string" ? [opt, opt] : opt;
          return (
            <option key={v} value={v}>
              {l}
            </option>
          );
        })}
      </select>
    </label>
  );
}

function Range({
  label,
  a,
  b,
  onA,
  onB,
}: {
  label: string;
  a: string;
  b: string;
  onA: (v: string) => void;
  onB: (v: string) => void;
}) {
  return (
    <label className="text-xs">
      <span className="mb-1 block text-terminal-muted">{label}</span>
      <span className="flex items-center gap-1">
        <input value={a} onChange={(e) => onA(e.target.value)} className="h-8 w-16 border border-terminal-border bg-terminal-panel px-1 font-mono" />
        <span className="text-terminal-muted">-</span>
        <input value={b} onChange={(e) => onB(e.target.value)} className="h-8 w-16 border border-terminal-border bg-terminal-panel px-1 font-mono" />
      </span>
    </label>
  );
}
