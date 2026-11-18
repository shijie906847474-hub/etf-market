"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { COLUMNS, DEFAULT_VISIBLE, columnLabel, type ColumnDef, type ColumnKey } from "@/components/columns";
import { fetchMarketStream, isAbortError } from "@/lib/client/market-stream";
import { HistorySettings } from "@/components/HistorySettings";
import { isHistoryCacheValid, readHistoryCache, writeHistoryCache } from "@/lib/client/prev-close-cache";
import { readLiveMarketCache, writeLiveMarketCache } from "@/lib/client/live-market-cache";
import { useRefreshInterval } from "@/lib/client/refresh-interval";
import type { LoadProgress } from "@/lib/load-progress";
import { changeClass, csvEscape, formatAum, formatDateOnly, formatMoney, formatNumber, formatPct, formatPrice, formatShanghai, formatVolumeHands, lastPriceLabel, VOLUME_RATIO_SURGE } from "@/lib/format";
import { shanghaiDateString } from "@/lib/market-hours";
import { buildThemeHotspots, classifyTheme, THEME_MIN_COUNT } from "@/lib/themes";
import type { EtfCategory, EtfRow, MarketPayload } from "@/lib/types";
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

function visibleColumnDefs(visible: ColumnKey[]): ColumnDef[] {
  return visible.map((key) => COLUMNS.find((c) => c.key === key)).filter((c): c is ColumnDef => Boolean(c));
}

type SortDir = "asc" | "desc";

interface Filters {
  search: string;
  category: "全部" | EtfCategory;
  changeBucket: string;
  premiumBucket: string;
  turnoverBucket: string;
  aumBucket: string;
  ret5Bucket: string;
  ret20Bucket: string;
  turnoverRateBucket: string;
  volumeRatioBucket: string;
  feeBucket: string;
  indexQuery: string;
  theme: string;
}

const EMPTY_FILTERS: Filters = {
  search: "",
  category: "全部",
  changeBucket: "",
  premiumBucket: "",
  turnoverBucket: "",
  aumBucket: "",
  ret5Bucket: "",
  ret20Bucket: "",
  turnoverRateBucket: "",
  volumeRatioBucket: "",
  feeBucket: "",
  indexQuery: "",
  theme: "",
};

type RangeBucket = { value: string; label: string; min: number | null; max: number | null };

const TURNOVER_BUCKETS: RangeBucket[] = [
  { value: "lt500", label: "小于 500万", min: null, max: 500 },
  { value: "500to2000", label: "500万～2000万", min: 500, max: 2000 },
  { value: "2000to10000", label: "2000万～1亿", min: 2000, max: 10000 },
  { value: "10000to50000", label: "1亿～5亿", min: 10000, max: 50000 },
  { value: "ge50000", label: "超过 5亿", min: 50000, max: null },
];

const AUM_BUCKETS: RangeBucket[] = [
  { value: "lt2", label: "小于 2亿", min: null, max: 2 },
  { value: "2to10", label: "2亿～10亿", min: 2, max: 10 },
  { value: "10to50", label: "10亿～50亿", min: 10, max: 50 },
  { value: "50to200", label: "50亿～200亿", min: 50, max: 200 },
  { value: "ge200", label: "超过 200亿", min: 200, max: null },
];

const TURNOVER_RATE_BUCKETS: RangeBucket[] = [
  { value: "lt05", label: "低于 0.5%", min: null, max: 0.5 },
  { value: "05to1", label: "0.5%～1%", min: 0.5, max: 1 },
  { value: "1to2", label: "1%～2%", min: 1, max: 2 },
  { value: "2to5", label: "2%～5%", min: 2, max: 5 },
  { value: "ge5", label: "超过 5%", min: 5, max: null },
];

const VOLUME_RATIO_BUCKETS: RangeBucket[] = [
  { value: "lt05", label: "低于 0.50", min: null, max: 0.5 },
  { value: "05to1", label: "0.50～1.00", min: 0.5, max: 1 },
  { value: "1to15", label: "1.00～1.50", min: 1, max: 1.5 },
  { value: "15to3", label: "1.50～3.00", min: 1.5, max: 3 },
  { value: "ge3", label: "超过 3.00", min: 3, max: null },
];

const FEE_BUCKETS: RangeBucket[] = [
  { value: "lt02", label: "低于 0.20%", min: null, max: 0.2 },
  { value: "02to04", label: "0.20%～0.40%", min: 0.2, max: 0.4 },
  { value: "04to06", label: "0.40%～0.60%", min: 0.4, max: 0.6 },
  { value: "06to10", label: "0.60%～1.00%", min: 0.6, max: 1 },
  { value: "ge10", label: "超过 1.00%", min: 1, max: null },
];

const CHANGE_OPTIONS: Array<[string, string]> = [
  ["", "全部"],
  ["up", "上涨"],
  ["down", "下跌"],
  ["flat", "平盘"],
  ["up5", "涨幅超过 5%"],
  ["up2to5", "涨幅 2%～5%"],
  ["up0to2", "涨幅 0%～2%"],
  ["down0to2", "跌幅 0%～2%"],
  ["down2to5", "跌幅 2%～5%"],
  ["down5", "跌幅超过 5%"],
];

const RET20_OPTIONS: Array<[string, string]> = [
  ["", "全部"],
  ["up10", "涨幅超过 10%"],
  ["up5to10", "涨幅 5%～10%"],
  ["up0to5", "涨幅 0%～5%"],
  ["down0to5", "跌幅 0%～5%"],
  ["down5to10", "跌幅 5%～10%"],
  ["down10", "跌幅超过 10%"],
];

function bucketOptions(rows: RangeBucket[]): Array<[string, string]> {
  return [["", "全部"], ...rows.map((r) => [r.value, r.label] as [string, string])];
}

function inBucket(value: number | null, min: number | null, max: number | null): boolean {
  if (min === null && max === null) return true;
  if (value === null) return false;
  if (min !== null && value < min) return false;
  if (max !== null && value >= max) return false;
  return true;
}

function matchRangeBucket(value: number | null, bucket: string, rows: RangeBucket[]): boolean {
  if (!bucket) return true;
  const row = rows.find((r) => r.value === bucket);
  if (!row) return true;
  return inBucket(value, row.min, row.max);
}

function matchChange(v: number | null, bucket: string): boolean {
  if (!bucket) return true;
  if (v === null) return false;
  switch (bucket) {
    case "up":
      return v > 0;
    case "down":
      return v < 0;
    case "flat":
      return v === 0;
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

function matchRet20(v: number | null, bucket: string): boolean {
  if (!bucket) return true;
  if (v === null) return false;
  switch (bucket) {
    case "up10":
      return v > 10;
    case "up5to10":
      return v >= 5 && v <= 10;
    case "up0to5":
      return v >= 0 && v < 5;
    case "down0to5":
      return v < 0 && v > -5;
    case "down5to10":
      return v <= -5 && v >= -10;
    case "down10":
      return v < -10;
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

function HeaderStat({
  label,
  value,
  sub,
  onClick,
  active,
}: {
  label: string;
  value: string;
  sub?: string;
  onClick?: () => void;
  active?: boolean;
}) {
  const className = cn(
    "border-r border-terminal-border px-3 py-2 last:border-r-0 min-w-[120px] text-left",
    onClick && "hover:bg-white/5",
    active && "bg-white/10",
  );
  const body = (
    <>
      <div className="text-[11px] text-terminal-muted">{label}</div>
      <div className="font-mono text-base tabular-nums">{value}</div>
      {sub ? <div className="text-[11px] text-terminal-muted">{sub}</div> : null}
    </>
  );
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={className}>
        {body}
      </button>
    );
  }
  return <div className={className}>{body}</div>;
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
  const [refreshing, setRefreshing] = useState(false);
  const [progress, setProgress] = useState<LoadProgress | null>(null);
  const [loadStartedAt, setLoadStartedAt] = useState<number | null>(null);
  const [nowTick, setNowTick] = useState(0);
  const [refreshIntervalMs] = useRefreshInterval();
  const refreshIntervalRef = useRef(refreshIntervalMs);
  refreshIntervalRef.current = refreshIntervalMs;
  const [nextRefreshAt, setNextRefreshAt] = useState<number | null>(null);
  const hasLiveRef = useRef(false);
  const tradeDatesRef = useRef<string[]>([]);
  const headerRef = useRef<HTMLElement>(null);
  const [headerOffset, setHeaderOffset] = useState(0);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [sortKey, setSortKey] = useState<ColumnKey>("turnover");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [visible, setVisible] = useState<ColumnKey[]>(DEFAULT_VISIBLE);
  const [showCols, setShowCols] = useState(false);
  const [groups, setGroups] = useState<WatchGroup[]>([]);

  useLayoutEffect(() => {
    const cached = readLiveMarketCache();
    if (!cached) return;
    hasLiveRef.current = true;
    setLiveData(cached);
    setLoading(false);
  }, []);

  useLayoutEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const update = () => setHeaderOffset(el.getBoundingClientRect().height);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [view]);

  useEffect(() => {
    setGroups(loadWatchlist());
    setVisible(loadVisibleColumns());
  }, []);

  const persistCols = (next: ColumnKey[]) => {
    setVisible(next);
    localStorage.setItem(COLUMN_STORE_KEY, JSON.stringify(next));
  };

  const moveVisibleCol = (index: number, dir: -1 | 1) => {
    const next = [...visible];
    const j = index + dir;
    if (j < 0 || j >= next.length) return;
    [next[index], next[j]] = [next[j], next[index]];
    persistCols(next);
  };

  const visibleDefs = visibleColumnDefs(visible);
  const hiddenCols = COLUMNS.filter((c) => !visible.includes(c.key));

  tradeDatesRef.current = tradeDates;
  const data = view === "history" ? prevData : liveData;

  const applyLive = useCallback((payload: MarketPayload) => {
    hasLiveRef.current = true;
    setLiveData(payload);
    writeLiveMarketCache(payload);
    setLoading(false);
  }, []);

  const loadLive = useCallback(async (opts?: { stream?: boolean; signal?: AbortSignal }) => {
    const keepExisting = hasLiveRef.current;
    if (keepExisting) setRefreshing(true);
    try {
      setError(null);
      const json = opts?.stream
        ? await fetchMarketStream("/api/market?stream=1", setProgress, opts.signal, (partial) => {
            applyLive(partial);
          })
        : await (async () => {
            const res = await fetch("/api/market", { cache: "no-store", signal: opts?.signal });
            const body = await res.json();
            if (!res.ok) throw new Error(body.error || "行情加载失败");
            return body as MarketPayload;
          })();
      if (opts?.signal?.aborted) return;
      applyLive(json);
    } catch (err) {
      if (opts?.signal?.aborted || isAbortError(err)) return;
      if (!keepExisting) setError(err instanceof Error ? err.message : "行情加载失败");
    } finally {
      if (!opts?.signal?.aborted) {
        setLoading(false);
        setRefreshing(false);
        if (hasLiveRef.current) setNextRefreshAt(Date.now() + refreshIntervalRef.current);
      }
    }
  }, [applyLive]);

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

  useEffect(() => {
    if (view === "settings") {
      setLoading(false);
      setProgress(null);
      setError(null);
      return;
    }
    const ac = new AbortController();
    if (view === "today") {
      const cached = readLiveMarketCache();
      if (cached) {
        hasLiveRef.current = true;
        setLiveData(cached);
        setLoading(false);
      }
      if (!hasLiveRef.current) {
        setLoading(true);
        setProgress(null);
        setLoadStartedAt(Date.now());
      } else {
        setLoading(false);
      }
      void loadLive({ stream: !hasLiveRef.current, signal: ac.signal });
      return () => ac.abort();
    }
    setProgress(null);
    setLoadStartedAt(Date.now());
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
    if (view !== "today") return;
    if (hasLiveRef.current) setNextRefreshAt(Date.now() + refreshIntervalMs);
    const id = window.setInterval(() => {
      if (!hasLiveRef.current) return;
      void loadLive({ stream: false });
    }, refreshIntervalMs);
    return () => window.clearInterval(id);
  }, [view, refreshIntervalMs, loadLive]);

  useEffect(() => {
    const needTick = (loading && !data) || view === "today";
    if (!needTick) return;
    setNowTick(Date.now());
    const id = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [loading, data, view]);

  const listedRows = useMemo(
    () => (data ? data.list.filter((row) => row.status !== "终止上市") : []),
    [data],
  );

  const pruneCascadeFilters = (next: Filters): Filters => {
    const inCat = next.category === "全部" ? listedRows : listedRows.filter((row) => row.category === next.category);
    if (next.theme && !inCat.some((row) => classifyTheme(row) === next.theme)) next.theme = "";
    const inTheme = next.theme ? inCat.filter((row) => classifyTheme(row) === next.theme) : inCat;
    const names = new Set(inTheme.map((row) => (row.indexName ?? "").trim()).filter(Boolean));
    const hasNone = inTheme.some((row) => !(row.indexName ?? "").trim());
    if (next.indexQuery === "__none__") {
      if (!hasNone) next.indexQuery = "";
    } else if (next.indexQuery && !names.has(next.indexQuery)) {
      next.indexQuery = "";
    }
    return next;
  };

  const updateFilter = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    setFilters((prev) => {
      const next = { ...prev, [key]: value };
      // 热点主题榜是全市场入口：当前类型下没有该主题时，放开类型，避免筛成空集。
      if (key === "theme" && value && next.category !== "全部") {
        const exists = listedRows.some((row) => row.category === next.category && classifyTheme(row) === value);
        if (!exists) next.category = "全部";
      }
      return pruneCascadeFilters(next);
    });
    setPage(1);
  };

  const themeHotspots = useMemo(() => (data ? buildThemeHotspots(data.list) : []), [data]);

  const themeOptions = useMemo(() => {
    const opts: Array<[string, string]> = [["", "全部"]];
    const source = filters.category === "全部" ? listedRows : listedRows.filter((row) => row.category === filters.category);
    const counts = new Map<string, number>();
    for (const row of source) {
      const theme = classifyTheme(row);
      counts.set(theme, (counts.get(theme) ?? 0) + 1);
    }
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-CN"));
    for (const [name, count] of sorted) opts.push([name, `${name}（${count}）`]);
    return opts;
  }, [listedRows, filters.category]);

  const indexOptions = useMemo(() => {
    const opts: Array<[string, string]> = [["", "全部"]];
    const source = listedRows.filter((row) => {
      if (filters.category !== "全部" && row.category !== filters.category) return false;
      if (filters.theme && classifyTheme(row) !== filters.theme) return false;
      return true;
    });
    const counts = new Map<string, number>();
    let missing = 0;
    for (const row of source) {
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
  }, [listedRows, filters.category, filters.theme]);

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
      if (!matchRangeBucket(row.turnover === null ? null : row.turnover / 1e4, filters.turnoverBucket, TURNOVER_BUCKETS)) return false;
      if (!matchRangeBucket(row.aum === null ? null : row.aum / 1e8, filters.aumBucket, AUM_BUCKETS)) return false;
      if (!matchChange(row.ret5d, filters.ret5Bucket)) return false;
      if (!matchRet20(row.ret20d, filters.ret20Bucket)) return false;
      if (!matchRangeBucket(row.turnoverRate, filters.turnoverRateBucket, TURNOVER_RATE_BUCKETS)) return false;
      if (!matchRangeBucket(row.volumeRatio, filters.volumeRatioBucket, VOLUME_RATIO_BUCKETS)) return false;
      if (!matchRangeBucket(row.operatingFee, filters.feeBucket, FEE_BUCKETS)) return false;
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
    const cols = visibleDefs;
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
      <header ref={headerRef} className="sticky top-0 z-30 border-b border-terminal-border bg-terminal-header/95 backdrop-blur-sm">
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
          <span>状态：{error ? "接口异常" : refreshing ? "正在刷新" : data?.freshness ?? (loading ? "加载中" : "—")}</span>
          {data ? (
            <span>
              {view === "history"
                ? `资料覆盖 ${data.f10Coverage}/${data.list.length} · 净值覆盖 ${data.navCoverage ?? 0}/${data.list.length}`
                : `资料覆盖 ${data.f10Coverage}/${data.list.length} · 净值覆盖 ${data.navCoverage ?? 0}/${data.list.length} · IOPV 覆盖 ${data.iopvCoverage}/${data.list.length}`}
            </span>
          ) : null}
          {view === "today" && (data || refreshing) ? (
            <span>
              {refreshing
                ? "正在刷新"
                : nextRefreshAt != null
                  ? `刷新倒计时 ${Math.max(0, Math.ceil((nextRefreshAt - (nowTick || Date.now())) / 1000))} 秒`
                  : null}
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
            <HeaderStat
              label="上涨"
              value={String(ov.up)}
              active={filters.changeBucket === "up"}
              onClick={() => updateFilter("changeBucket", filters.changeBucket === "up" ? "" : "up")}
            />
            <HeaderStat
              label="下跌"
              value={String(ov.down)}
              active={filters.changeBucket === "down"}
              onClick={() => updateFilter("changeBucket", filters.changeBucket === "down" ? "" : "down")}
            />
            <HeaderStat
              label="平盘"
              value={String(ov.flat)}
              active={filters.changeBucket === "flat"}
              onClick={() => updateFilter("changeBucket", filters.changeBucket === "flat" ? "" : "flat")}
            />
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
                  title={`放量上涨 TOP 5（量比≥${VOLUME_RATIO_SURGE.toFixed(2)}）`}
                  rows={ov.topVolumeUp ?? []}
                  field="changePct"
                  showVolumeRatio
                  emptyText={`暂无量比≥${VOLUME_RATIO_SURGE.toFixed(2)} 的上涨品种`}
                />
                <RankList
                  title={`放量下跌 TOP 5（量比≥${VOLUME_RATIO_SURGE.toFixed(2)}）`}
                  rows={ov.topVolumeDown ?? []}
                  field="changePct"
                  showVolumeRatio
                  emptyText={`暂无量比≥${VOLUME_RATIO_SURGE.toFixed(2)} 的下跌品种`}
                />
              </>
            ) : (
              <div className="border-r border-terminal-border px-3 py-2 lg:col-span-2">
                <div className="mb-1 h-5 truncate text-[12px] leading-5 text-terminal-muted">放量上涨 / 放量下跌</div>
                <div className="text-[11px] leading-relaxed text-terminal-muted">
                  该榜依赖盘中量比（相对近 5 日同时段均量），历史收盘快照没有这一字段，因此不展示。
                </div>
              </div>
            )}
            <div className="border-r border-terminal-border last:border-r-0 px-3 py-2">
              <div
                className="mb-1 h-5 truncate text-[12px] leading-5 text-terminal-muted"
                title="超额收益 = 该主题成交额加权涨跌幅 − 全市场成交额加权涨跌幅（不含货币、停牌、暂停、无行情）。右侧为该主题成交额加权量比；历史收盘快照无量比。"
              >
                {view === "history" ? "收盘日热点主题" : "当日热点主题"}（至少{THEME_MIN_COUNT}只，超额）
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
                      "flex w-full items-center gap-2 py-0.5 text-left text-sm hover:bg-white/5",
                      filters.theme === h.theme && "bg-white/10",
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {h.theme}{" "}
                      <span className="text-[11px] text-terminal-muted">
                        {h.count}只 {h.up}/{h.down}
                      </span>
                    </span>
                    <span className={cn("w-14 shrink-0 text-right font-mono tabular-nums", changeClass(h.excessReturn))}>{formatPct(h.excessReturn)}</span>
                    <span className="w-8 shrink-0 text-right font-mono text-[11px] tabular-nums text-terminal-muted">
                      {h.volumeRatio === null ? "" : formatNumber(h.volumeRatio, 2)}
                    </span>
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
          <SearchSelect
            label="跟踪指数"
            value={filters.indexQuery}
            onChange={(v) => updateFilter("indexQuery", v)}
            options={indexOptions}
            className="w-[18rem]"
          />
          <SearchSelect
            label="热点主题"
            value={filters.theme}
            onChange={(v) => updateFilter("theme", v)}
            options={themeOptions}
            className="w-[16rem]"
          />
          <Select
            label="涨跌幅"
            value={filters.changeBucket}
            onChange={(v) => updateFilter("changeBucket", v)}
            options={CHANGE_OPTIONS}
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
          <Select label="成交额" value={filters.turnoverBucket} onChange={(v) => updateFilter("turnoverBucket", v)} options={bucketOptions(TURNOVER_BUCKETS)} />
          <Select label="规模" value={filters.aumBucket} onChange={(v) => updateFilter("aumBucket", v)} options={bucketOptions(AUM_BUCKETS)} />
          <Select label="近5日涨幅" value={filters.ret5Bucket} onChange={(v) => updateFilter("ret5Bucket", v)} options={CHANGE_OPTIONS} />
          <Select label="近20日涨幅" value={filters.ret20Bucket} onChange={(v) => updateFilter("ret20Bucket", v)} options={RET20_OPTIONS} />
          <Select label="换手率" value={filters.turnoverRateBucket} onChange={(v) => updateFilter("turnoverRateBucket", v)} options={bucketOptions(TURNOVER_RATE_BUCKETS)} />
          <Select label="量比" value={filters.volumeRatioBucket} onChange={(v) => updateFilter("volumeRatioBucket", v)} options={bucketOptions(VOLUME_RATIO_BUCKETS)} />
          <Select label="运作费率" value={filters.feeBucket} onChange={(v) => updateFilter("feeBucket", v)} options={bucketOptions(FEE_BUCKETS)} />
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
              <div className="absolute right-0 z-50 mt-1 max-h-80 w-60 overflow-auto border border-terminal-border bg-terminal-panel p-2 text-xs shadow-xl">
                <div className="mb-1 text-[10px] text-terminal-muted">勾选显示，用箭头调整已显示列的顺序</div>
                {visible.map((key, i) => (
                  <div key={key} className="flex items-center gap-1 py-0.5">
                    <input
                      type="checkbox"
                      checked
                      onChange={() => {
                        const next = visible.filter((k) => k !== key);
                        if (next.length) persistCols(next);
                      }}
                    />
                    <span className="min-w-0 flex-1 truncate">{columnLabel(key, view)}</span>
                    <button
                      type="button"
                      disabled={i === 0}
                      onClick={() => moveVisibleCol(i, -1)}
                      className="h-5 w-5 shrink-0 border border-terminal-border text-[10px] leading-none disabled:opacity-30"
                      aria-label="上移"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      disabled={i === visible.length - 1}
                      onClick={() => moveVisibleCol(i, 1)}
                      className="h-5 w-5 shrink-0 border border-terminal-border text-[10px] leading-none disabled:opacity-30"
                      aria-label="下移"
                    >
                      ↓
                    </button>
                  </div>
                ))}
                {hiddenCols.map((c) => (
                  <label key={c.key} className="flex items-center gap-1 py-0.5 text-terminal-muted">
                    <input type="checkbox" checked={false} onChange={() => persistCols([...visible, c.key])} />
                    <span className="min-w-0 flex-1 truncate">{columnLabel(c.key, view)}</span>
                    <span className="w-5 shrink-0" />
                    <span className="w-5 shrink-0" />
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
          <table className="min-w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th
                  className="sticky z-20 w-8 border-b border-terminal-border bg-terminal-header px-1 py-1 text-left font-medium text-terminal-muted"
                  style={{ top: headerOffset }}
                >
                  自选
                </th>
                {visibleDefs.map((c) => (
                  <th
                    key={c.key}
                    onClick={() => onSort(c.key)}
                    className={cn(
                      "sticky z-20 cursor-pointer whitespace-nowrap border-b border-terminal-border bg-terminal-header px-2 py-1 font-medium text-terminal-muted hover:text-terminal-text",
                      c.align === "right" ? "text-right" : "text-left",
                    )}
                    style={{ top: headerOffset }}
                  >
                    {columnLabel(c.key, view)}
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
                    const statusMuted =
                      (c.key === "last" || c.key === "status") &&
                      (row.status === "停牌" || row.status === "暂停交易" || row.status === "无行情" || row.status === "终止上市");
                    return (
                      <td key={c.key} className={cn("whitespace-nowrap px-2 py-1", c.align === "right" && "text-right")}>
                        <span
                          className={cn(
                            c.numeric && "font-mono tabular-nums",
                            statusMuted && "text-terminal-muted",
                            !statusMuted && colored && changeClass(row[c.key] as number | null),
                          )}
                        >
                          {cellValue(row, c.key)}
                        </span>
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
  rows,
  field,
  showVolumeRatio,
  emptyText,
}: {
  title: string;
  rows: EtfRow[];
  field: "changePct" | "turnover";
  showVolumeRatio?: boolean;
  emptyText?: string;
}) {
  return (
    <div className="border-r border-terminal-border px-3 py-2 last:border-r-0">
      <div className="mb-1 h-5 truncate text-[12px] leading-5 text-terminal-muted" title={title}>{title}</div>
      {rows.length === 0 && emptyText ? (
        <div className="py-1 text-[11px] text-terminal-muted">{emptyText}</div>
      ) : null}
      {rows.map((row, i) => (
        <div key={row.code} className="flex items-center gap-2 py-0.5 text-sm">
          <span className="w-4 shrink-0 font-mono tabular-nums text-terminal-muted">{i + 1}</span>
          <span className="min-w-0 flex-1 truncate">{row.name}</span>
          <span className={cn("w-14 shrink-0 text-right font-mono tabular-nums", field === "changePct" ? changeClass(row.changePct) : "text-terminal-text")}>
            {field === "changePct" ? formatPct(row.changePct) : formatMoney(row.turnover)}
          </span>
          <span className="w-8 shrink-0 text-right font-mono text-[10px] tabular-nums text-terminal-muted">
            {showVolumeRatio ? formatNumber(row.volumeRatio, 2) : ""}
          </span>
        </div>
      ))}
    </div>
  );
}

function normalizeFilterText(s: string) {
  return s.trim().toLowerCase().replace(/\s+/g, "");
}

function fuzzyFilterText(haystack: string, query: string): boolean {
  const h = normalizeFilterText(haystack);
  const q = normalizeFilterText(query);
  if (!q) return true;
  if (h.includes(q)) return true;
  let i = 0;
  for (const ch of h) {
    if (ch === q[i]) {
      i += 1;
      if (i >= q.length) return true;
    }
  }
  return false;
}

function SearchSelect({
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
  const rootRef = useRef<HTMLLabelElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [typing, setTyping] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const parsed = useMemo(
    () => options.map((opt) => (typeof opt === "string" ? ([opt, opt] as [string, string]) : opt)),
    [options],
  );
  const selectedLabel = parsed.find(([v]) => v === value)?.[1] ?? "全部";
  const filtered = useMemo(() => {
    if (!open || !typing || !query.trim()) return parsed;
    return parsed.filter(([v, l]) => fuzzyFilterText(l, query) || fuzzyFilterText(v, query));
  }, [parsed, open, typing, query]);

  const close = () => {
    setOpen(false);
    setTyping(false);
    setQuery("");
    setActive(0);
  };

  const pick = (next: string) => {
    onChange(next);
    close();
  };

  useEffect(() => {
    if (!open) return;
    const onDoc = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close();
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [query, open]);

  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector("[data-active='true']") as HTMLElement | null;
    el?.scrollIntoView({ block: "nearest" });
  }, [active, open, filtered]);

  return (
    <label ref={rootRef} className={cn("relative text-xs", className)}>
      <span className="mb-1 block text-terminal-muted">{label}</span>
      <input
        value={open && typing ? query : selectedLabel}
        placeholder="输入筛选"
        onChange={(e) => {
          setTyping(true);
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((i) => Math.min(i + 1, Math.max(filtered.length - 1, 0)));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setOpen(true);
            setActive((i) => Math.max(i - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            const hit = filtered[active];
            if (hit) pick(hit[0]);
          } else if (e.key === "Escape") {
            e.preventDefault();
            close();
            (e.target as HTMLInputElement).blur();
          }
        }}
        className="h-8 w-full border border-terminal-border bg-terminal-panel px-2 text-sm outline-none focus:border-terminal-text/40"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        autoComplete="off"
        spellCheck={false}
      />
      {open ? (
        <div
          ref={listRef}
          role="listbox"
          className="absolute z-30 mt-0.5 max-h-64 w-full min-w-full overflow-y-auto border border-terminal-border bg-terminal-header shadow-lg"
        >
          {filtered.length === 0 ? (
            <div className="px-2 py-2 text-[12px] text-terminal-muted">无匹配项</div>
          ) : (
            filtered.map(([v, l], i) => {
              const isActive = i === active;
              const isSelected = v === value;
              return (
                <button
                  key={`${v}::${l}`}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  data-active={isActive ? "true" : "false"}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(v);
                  }}
                  className={cn(
                    "block w-full truncate px-2 py-1 text-left text-sm",
                    isActive ? "bg-white/10 text-terminal-text" : "text-terminal-text/90",
                    isSelected && !isActive ? "text-terminal-text" : null,
                  )}
                >
                  {isSelected ? "✓ " : ""}
                  {l}
                </button>
              );
            })
          )}
        </div>
      ) : null}
    </label>
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
