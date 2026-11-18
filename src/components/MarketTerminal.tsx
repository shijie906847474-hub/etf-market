"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { COLUMNS, DEFAULT_VISIBLE, columnLabel, type ColumnKey } from "@/components/columns";
import { fetchMarketStream, isAbortError } from "@/lib/client/market-stream";
import { HistorySettings } from "@/components/HistorySettings";
import { isHistoryCacheValid, readHistoryCache, writeHistoryCache } from "@/lib/client/prev-close-cache";
import type { LoadProgress } from "@/lib/load-progress";
import { changeClass, csvEscape, formatAum, formatDateOnly, formatMoney, formatNumber, formatPct, formatPrice, formatShanghai, formatVolumeHands, lastPriceLabel, VOLUME_RATIO_SURGE } from "@/lib/format";
import { shanghaiDateString } from "@/lib/market-hours";
import { buildThemeHotspots, classifyTheme, THEME_MIN_COUNT } from "@/lib/themes";
import type { EtfCategory, EtfRow, MarketPayload } from "@/lib/types";
import { ALL_CATEGORIES } from "@/lib/types";
import { isWatched, loadWatchlist, saveWatchlist, toggleWatch, type WatchGroup } from "@/lib/watchlist";
import { cn } from "@/lib/cn";

type MarketView = "today" | "history" | "settings";
const COLUMN_STORE_KEY = "etf-market-columns-v3";
const COLUMN_STORE_LEGACY = ["etf-market-columns-v2", "etf-market-columns-v1"];

const COLUMN_KEYS = new Set<string>(COLUMNS.map((c) => c.key));

function migrateVisible(saved: string[]): ColumnKey[] {
  const next: ColumnKey[] = [];
  for (const key of saved) {
    if (key === "managementFee") {
      if (!next.includes("operatingFee")) next.push("operatingFee");
      continue;
    }
    if (key === "custodyFee") continue;
    if (COLUMN_KEYS.has(key) && !next.includes(key as ColumnKey)) next.push(key as ColumnKey);
  }
  const insertAfter = (key: ColumnKey, after: ColumnKey) => {
    if (next.includes(key)) return;
    const i = next.indexOf(after);
    if (i >= 0) next.splice(i + 1, 0, key);
    else next.push(key);
  };
  insertAfter("ytdChangePct", "aum");
  insertAfter("operatingFee", "ytdChangePct");
  return next;
}

function loadVisibleColumns(): ColumnKey[] {
  try {
    const current = localStorage.getItem(COLUMN_STORE_KEY);
    if (current) return migrateVisible(JSON.parse(current) as string[]);
    for (const key of COLUMN_STORE_LEGACY) {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const migrated = migrateVisible(JSON.parse(raw) as string[]);
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
  indexQuery: string;
  theme: string;
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
  indexQuery: "",
  theme: "",
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
      return lastPriceLabel(row);
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
    case "operatingFee":
      return row.operatingFee === null ? "—" : `${row.operatingFee.toFixed(2)}%`;
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

function LoadProgressPanel({
  view,
  progress,
  startedAt,
  now,
}: {
  view: MarketView;
  progress: LoadProgress | null;
  startedAt: number | null;
  now: number;
}) {
  const percent = progress?.percent ?? 0;
  const elapsed = startedAt ? Math.max(0, Math.floor(((now || Date.now()) - startedAt) / 1000)) : 0;
  const fallback =
    view === "history" ? "正在构建所选交易日的收盘快照…" : "正在从服务端拉取沪深场内 ETF 全量行情…";
  return (
    <div className="max-w-xl px-3 py-10">
      <div className="text-sm text-terminal-muted">{progress?.label ?? fallback}</div>
      <div
        className="mt-3 h-1.5 overflow-hidden rounded-sm bg-terminal-border"
        role="progressbar"
        aria-label="数据加载进度"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <div
          className={cn(
            "h-full bg-terminal-text",
            progress ? "transition-[width] duration-300 ease-out" : "w-1/5 animate-pulse",
          )}
          style={progress ? { width: `${Math.min(100, Math.max(percent, 2))}%` } : undefined}
        />
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 text-[11px] font-mono text-terminal-muted">
        <span>{percent}%</span>
        {progress && progress.total > 1 ? <span>{progress.done}/{progress.total}</span> : null}
        <span>已用时 {elapsed} 秒</span>
      </div>
      {view === "history" ? (
        <div className="mt-2 text-[11px] text-terminal-muted">
          该日期首次加载需按代码拉取日 K 与当日净值，可能需要一两分钟；完成后会写入服务端本地缓存，之后打开同一交易日无需再请求。
        </div>
      ) : null}
    </div>
  );
}

export function MarketTerminal() {
  const [view, setView] = useState<MarketView>("today");
  const [liveData, setLiveData] = useState<MarketPayload | null>(null);
  const [prevData, setPrevData] = useState<MarketPayload | null>(null);
  const [historyDate, setHistoryDate] = useState("");
  const [tradeDates, setTradeDates] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState<LoadProgress | null>(null);
  const [loadStartedAt, setLoadStartedAt] = useState<number | null>(null);
  const [nowTick, setNowTick] = useState(0);
  const hasLiveRef = useRef(false);
  const tradeDatesRef = useRef<string[]>([]);
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

  tradeDatesRef.current = tradeDates;
  const data = view === "history" ? prevData : liveData;

  const loadLive = useCallback(async (opts?: { stream?: boolean; signal?: AbortSignal }) => {
    try {
      setError(null);
      const json = opts?.stream
        ? await fetchMarketStream("/api/market?stream=1", setProgress, opts.signal)
        : await (async () => {
            const res = await fetch("/api/market", { cache: "no-store", signal: opts?.signal });
            const body = await res.json();
            if (!res.ok) throw new Error(body.error || "行情加载失败");
            return body as MarketPayload;
          })();
      if (opts?.signal?.aborted) return;
      hasLiveRef.current = true;
      setLiveData(json);
    } catch (err) {
      if (opts?.signal?.aborted || isAbortError(err)) return;
      setError(err instanceof Error ? err.message : "行情加载失败");
    } finally {
      if (!opts?.signal?.aborted) setLoading(false);
    }
  }, []);

  const ensureTradeDates = useCallback(async (signal?: AbortSignal) => {
    if (tradeDatesRef.current.length) return tradeDatesRef.current;
    const res = await fetch("/api/history/dates", { cache: "no-store", signal });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || "无法获取交易日列表");
    const dates: string[] = Array.isArray(body.dates) ? body.dates : [];
    tradeDatesRef.current = dates;
    setTradeDates(dates);
    return dates;
  }, []);

  const loadHistory = useCallback(async (date: string, signal?: AbortSignal, force = false) => {
    const today = shanghaiDateString();
    try {
      setError(null);
      if (!date) return;
      setPrevData((curr) => (curr?.asOfDate === date ? curr : null));
      if (!force) {
        const cached = await readHistoryCache(date);
        if (signal?.aborted) return;
        if (isHistoryCacheValid(cached, date) && cached) {
          setPrevData(cached.payload);
          setLoading(false);
          return;
        }
      }
      setLoading(true);
      const qs = new URLSearchParams({ view: "history", date, stream: "1" });
      const json = await fetchMarketStream(`/api/market?${qs.toString()}`, setProgress, signal);
      if (signal?.aborted) return;
      setPrevData(json);
      if (json?.asOfDate && Array.isArray(json.list)) {
        await writeHistoryCache({
          asOfDate: json.asOfDate,
          shanghaiDate: today,
          savedAt: Date.now(),
          payload: json,
        });
      }
    } catch (err) {
      if (signal?.aborted || isAbortError(err)) return;
      setError(err instanceof Error ? err.message : "历史收盘快照加载失败");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  const load = useCallback(() => {
    if (view === "settings") return;
    setProgress(null);
    setLoadStartedAt(Date.now());
    return view === "history" ? loadHistory(historyDate, undefined, true) : loadLive({ stream: !hasLiveRef.current });
  }, [view, historyDate, loadHistory, loadLive]);

  useEffect(() => {
    if (view === "settings") {
      setLoading(false);
      setProgress(null);
      setError(null);
      return;
    }
    const ac = new AbortController();
    setLoading(true);
    setProgress(null);
    setLoadStartedAt(Date.now());
    if (view === "today") {
      void loadLive({ stream: !hasLiveRef.current, signal: ac.signal });
      const id = window.setInterval(() => void loadLive({ stream: false }), 15000);
      return () => {
        ac.abort();
        window.clearInterval(id);
      };
    }
    void (async () => {
      try {
        setError(null);
        const dates = await ensureTradeDates(ac.signal);
        if (ac.signal.aborted) return;
        if (!historyDate) {
          const next = dates[0] ?? "";
          if (next) setHistoryDate(next);
          else {
            setError("无法确定可展示的历史交易日");
            setLoading(false);
          }
          return;
        }
        if (dates.length && !dates.includes(historyDate)) {
          setError(`${historyDate} 不是已结束的沪深交易日，没有收盘行情可展示。`);
          setPrevData(null);
          setLoading(false);
          return;
        }
        await loadHistory(historyDate, ac.signal);
      } catch (err) {
        if (ac.signal.aborted || isAbortError(err)) return;
        setError(err instanceof Error ? err.message : "无法获取交易日列表");
        setLoading(false);
      }
    })();
    return () => ac.abort();
  }, [view, historyDate, loadLive, loadHistory, ensureTradeDates]);

  useEffect(() => {
    if (!loading || data) return;
    setNowTick(Date.now());
    const id = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [loading, data]);

  const updateFilter = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  };

  const themeHotspots = useMemo(() => (data ? buildThemeHotspots(data.list) : []), [data]);

  const indexOptions = useMemo(() => {
    const opts: Array<[string, string]> = [["", "全部"]];
    if (!data) return opts;
    const counts = new Map<string, number>();
    let missing = 0;
    for (const row of data.list) {
      if (row.status === "终止上市") continue;
      const name = (row.indexName ?? "").trim();
      if (!name) {
        missing += 1;
        continue;
      }
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-CN"));
    for (const [name, count] of sorted) opts.push([name, `${name}（${count}）`]);
    if (missing > 0) opts.push(["__none__", `未披露跟踪指数（${missing}）`]);
    return opts;
  }, [data]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = filters.search.trim().toLowerCase();
    return data.list.filter((row) => {
      if (row.status === "终止上市") return false;
      if (filters.category !== "全部" && row.category !== filters.category) return false;
      if (filters.theme && classifyTheme(row) !== filters.theme) return false;
      if (q && !row.code.includes(q) && !row.name.toLowerCase().includes(q)) return false;
      const idx = filters.indexQuery;
      if (idx === "__none__") {
        if ((row.indexName ?? "").trim()) return false;
      } else if (idx) {
        if ((row.indexName ?? "").trim() !== idx) return false;
      }
      if (!matchChange(row.changePct, filters.changeBucket)) return false;
      if (!matchPremium(row.premiumPct, filters.premiumBucket)) return false;
      if (!inRange(row.turnover === null ? null : row.turnover / 1e4, numOrNull(filters.turnoverMin), numOrNull(filters.turnoverMax)))
        return false;
      if (!inRange(row.aum === null ? null : row.aum / 1e8, numOrNull(filters.aumMin), numOrNull(filters.aumMax))) return false;
      if (!inRange(row.ret5d, numOrNull(filters.ret5Min), numOrNull(filters.ret5Max))) return false;
      if (!inRange(row.ret20d, numOrNull(filters.ret20Min), numOrNull(filters.ret20Max))) return false;
      if (!inRange(row.turnoverRate, numOrNull(filters.turnoverRateMin), numOrNull(filters.turnoverRateMax))) return false;
      if (!inRange(row.volumeRatio, numOrNull(filters.volumeRatioMin), numOrNull(filters.volumeRatioMax))) return false;
      if (!inRange(row.operatingFee, numOrNull(filters.feeMin), numOrNull(filters.feeMax))) return false;
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
    const header = cols.map((c) => csvEscape(columnLabel(c.key, view))).join(",");
    const lines = sorted.map((row) => cols.map((c) => csvEscape(cellValue(row, c.key))).join(","));
    const blob = new Blob(["\uFEFF" + [header, ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `etf-market-${view === "history" && data?.asOfDate ? data.asOfDate : new Date().toISOString().slice(0, 10)}.csv`;
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
                onClick={() => setView("history")}
                className={cn(
                  "rounded border px-2 py-0.5 text-xs",
                  view === "history"
                    ? "border-terminal-text text-terminal-text"
                    : "border-transparent text-terminal-muted hover:text-terminal-text",
                )}
              >
                历史市场
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
              <button
                type="button"
                onClick={() => setView("settings")}
                className={cn(
                  "rounded border px-2 py-0.5 text-xs",
                  view === "settings"
                    ? "border-terminal-text text-terminal-text"
                    : "border-transparent text-terminal-muted hover:text-terminal-text",
                )}
              >
                设置
              </button>
            </div>
            {view === "history" ? (
              <label className="flex items-center gap-1 text-xs text-terminal-muted">
                <span>收盘日期</span>
                <input
                  type="date"
                  value={historyDate}
                  max={tradeDates[0] || undefined}
                  min={tradeDates.length ? tradeDates[tradeDates.length - 1] : undefined}
                  list="history-trade-dates"
                  onChange={(e) => setHistoryDate(e.target.value)}
                  className="border border-terminal-border bg-transparent px-1 py-0.5 font-mono text-xs text-terminal-text"
                />
                <datalist id="history-trade-dates">
                  {tradeDates.map((d) => (
                    <option key={d} value={d} />
                  ))}
                </datalist>
              </label>
            ) : null}
            <Link href="/watchlist" className="text-terminal-muted hover:text-terminal-text">
              我的自选
            </Link>
            {view === "settings" ? null : (
              <button type="button" onClick={() => void load()} className="rounded border border-terminal-border px-2 py-0.5 text-xs text-terminal-muted hover:text-terminal-text">
                刷新
              </button>
            )}
          </nav>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-terminal-border px-3 py-1 text-[11px] text-terminal-muted">
          <span>数据来源：{data?.source ?? "东方财富公开行情"}</span>
          {view === "settings" ? (
            <span>管理已缓存的历史收盘行情</span>
          ) : view === "history" ? (
            <>
              <span>收盘日期 {data?.asOfDate ?? historyDate ?? "—"}</span>
              <span>历史收盘快照（服务端按日期缓存，非实时行情）· 收盘溢价（当日净值）</span>
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
              {view === "history"
                ? `资料覆盖 ${data.f10Coverage}/${data.list.length} · 净值覆盖 ${data.navCoverage ?? 0}/${data.list.length}`
                : `资料覆盖 ${data.f10Coverage}/${data.list.length} · 净值覆盖 ${data.navCoverage ?? 0}/${data.list.length} · IOPV 覆盖 ${data.iopvCoverage}/${data.list.length}`}
            </span>
          ) : null}
        </div>
      </header>

      {view === "settings" ? (
        <HistorySettings />
      ) : (
      <>
      {error ? (
        <div className="m-3 border border-up/40 bg-up/10 px-3 py-2 text-sm text-up">加载失败：{error}。页面不会用模拟数据替代真实行情。</div>
      ) : null}
      {loading && !data ? (
        <LoadProgressPanel view={view} progress={progress} startedAt={loadStartedAt} now={nowTick} />
      ) : null}

      {ov ? (
        <>
          <section className="flex flex-wrap border-b border-terminal-border">
            <HeaderStat label="ETF 数量" value={String(ov.totalCount)} sub={`正常上市 ${ov.listedCount}${ov.haltedCount ? ` · 停牌 ${ov.haltedCount}` : ""}${ov.noQuoteCount ? ` · 无行情 ${ov.noQuoteCount}` : ""}${ov.pausedCount ? ` · 暂停 ${ov.pausedCount}` : ""}`} />
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

          <section className="grid grid-cols-1 gap-0 border-b border-terminal-border lg:grid-cols-5">
            <RankList title="涨幅榜 TOP 5" rows={ov.topGainers} field="changePct" />
            <RankList title="跌幅榜 TOP 5" rows={ov.topLosers} field="changePct" />
            {view === "today" ? (
              <>
                <RankList
                  title="放量上涨 TOP 5"
                  subtitle={`量比≥${VOLUME_RATIO_SURGE.toFixed(2)}`}
                  rows={ov.topVolumeUp ?? []}
                  field="changePct"
                  showVolumeRatio
                  emptyText={`暂无量比≥${VOLUME_RATIO_SURGE.toFixed(2)} 的上涨品种`}
                />
                <RankList
                  title="放量下跌 TOP 5"
                  subtitle={`量比≥${VOLUME_RATIO_SURGE.toFixed(2)}`}
                  rows={ov.topVolumeDown ?? []}
                  field="changePct"
                  showVolumeRatio
                  emptyText={`暂无量比≥${VOLUME_RATIO_SURGE.toFixed(2)} 的下跌品种`}
                />
              </>
            ) : (
              <div className="border-r border-terminal-border px-3 py-2 lg:col-span-2">
                <div className="mb-1 text-[12px] text-terminal-muted">放量上涨 / 放量下跌</div>
                <div className="text-[11px] leading-relaxed text-terminal-muted">
                  该榜依赖盘中量比（相对近 5 日同时段均量），历史收盘快照没有这一字段，因此不展示。
                </div>
              </div>
            )}
            <div className="border-r border-terminal-border last:border-r-0 px-3 py-2">
              <div className="mb-1 text-[12px] text-terminal-muted">{view === "history" ? "收盘日热点主题" : "当日热点主题"}</div>
              <div className="text-[10px] text-terminal-muted mb-1">
                按跟踪指数归类，成交额加权涨跌幅；至少 {THEME_MIN_COUNT} 只
              </div>
              {themeHotspots.length === 0 ? (
                <div className="text-[11px] leading-relaxed text-terminal-muted">暂无满足只数要求的主题</div>
              ) : (
                themeHotspots.map((h) => (
                  <button
                    key={h.theme}
                    type="button"
                    onClick={() => updateFilter("theme", filters.theme === h.theme ? "" : h.theme)}
                    className={cn(
                      "flex w-full items-center justify-between py-0.5 text-left text-sm hover:bg-white/5",
                      filters.theme === h.theme && "bg-white/10",
                    )}
                  >
                    <span>
                      {h.theme} <span className="text-[11px] text-terminal-muted">{h.count}只</span>
                    </span>
                    <span className={cn("font-mono", changeClass(h.weightedReturn))}>{formatPct(h.weightedReturn)}</span>
                  </button>
                ))
              )}
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
          <Select
            label="跟踪指数"
            value={filters.indexQuery}
            onChange={(v) => updateFilter("indexQuery", v)}
            options={indexOptions}
            className="max-w-[18rem]"
          />
          <Select label="类型" value={filters.category} onChange={(v) => updateFilter("category", v as Filters["category"])} options={["全部", ...ALL_CATEGORIES]} />
          {filters.theme ? (
            <button
              type="button"
              onClick={() => updateFilter("theme", "")}
              className="h-8 border border-terminal-border px-2 text-xs hover:bg-white/5"
            >
              主题：{filters.theme} ×
            </button>
          ) : null}
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
            label={view === "history" ? "收盘溢价" : "折溢价"}
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
          <Range label="运作费率%" a={filters.feeMin} b={filters.feeMax} onA={(v) => updateFilter("feeMin", v)} onB={(v) => updateFilter("feeMax", v)} />
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
                    {columnLabel(c.key, view)}
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
        <div>
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
                    {columnLabel(c.key, view)}
                    {sortKey === c.key ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
                    {c.key === "premiumPct" ? (
                      <span className="ml-1 text-[10px] font-normal text-terminal-muted">净值</span>
                    ) : null}
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
                    const statusMuted =
                      (c.key === "last" || c.key === "status") &&
                      (row.status === "停牌" || row.status === "暂停交易" || row.status === "无行情" || row.status === "终止上市");
                    const href = `/etf/${row.code}?market=${row.market}`;
                    const inner = (
                      <span
                        className={cn(
                          c.numeric && "font-mono tabular-nums",
                          statusMuted && "text-terminal-muted",
                          !statusMuted && colored && changeClass(row[c.key] as number | null),
                        )}
                      >
                        {cellValue(row, c.key)}
                        {c.key === "aum" && row.aumDate ? (
                          <span className="ml-1 text-[10px] text-terminal-muted">{row.aumDate}</span>
                        ) : null}
                        {c.key === "premiumPct" && row.navDate ? (
                          <span className="ml-1 text-[10px] font-normal text-terminal-muted">{row.navDate}</span>
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
      </>
      )}
    </div>
  );
}

function RankList({
  title,
  subtitle,
  rows,
  field,
  showVolumeRatio,
  emptyText,
}: {
  title: string;
  subtitle?: string;
  rows: EtfRow[];
  field: "changePct" | "turnover";
  showVolumeRatio?: boolean;
  emptyText?: string;
}) {
  return (
    <div className="border-r border-terminal-border px-3 py-2 last:border-r-0">
      <div className="mb-1 text-[12px] text-terminal-muted">{title}</div>
      {subtitle ? <div className="mb-1 text-[10px] text-terminal-muted">{subtitle}</div> : null}
      {rows.length === 0 && emptyText ? (
        <div className="py-1 text-[11px] text-terminal-muted">{emptyText}</div>
      ) : null}
      {rows.map((row, i) => (
        <Link key={row.code} href={`/etf/${row.code}?market=${row.market}`} className="flex items-center justify-between py-0.5 text-sm hover:bg-white/5">
          <span className="truncate">
            <span className="mr-2 font-mono text-terminal-muted">{i + 1}</span>
            {row.name}
          </span>
          <span className={cn("ml-2 shrink-0 font-mono", field === "changePct" ? changeClass(row.changePct) : "text-terminal-text")}>
            {field === "changePct" ? formatPct(row.changePct) : formatMoney(row.turnover)}
            {showVolumeRatio ? <span className="ml-2 text-[10px] text-terminal-muted">{formatNumber(row.volumeRatio, 2)}</span> : null}
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
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<string | [string, string]>;
  className?: string;
}) {
  return (
    <label className="text-xs">
      <span className="mb-1 block text-terminal-muted">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn("h-8 border border-terminal-border bg-terminal-panel px-1 text-sm", className)}
      >
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
