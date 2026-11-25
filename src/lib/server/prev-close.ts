import { mapPool } from "../async-pool";
import { deleteCacheFile, listCacheFiles, memoryDelete, memoryDeleteByPrefix, memoryGet, memorySet, readJsonFile, writeJsonFile } from "../cache";
import { PREV_CLOSE_PAYLOAD_VERSION } from "../prev-close-version";
import { alignOfficialNav, isMoneyMarketFund } from "../format";
import { shanghaiDateString, shanghaiSessionCloseUnix } from "../market-hours";
import { getMarketProvider } from "../providers";
import {
  fetchKlineWithSource,
  probeEastMoneyDailyKline,
  type KlineFetchSource,
} from "../providers/eastmoney";
import type { OfficialNav, QuoteRaw } from "../providers/types";
import { findBarOnDate, periodReturnFromBars, yearReturnFromBars, ytdChangePctFromBars } from "../returns";
import type { HistoryCacheItem, KlineBar, MarketPayload } from "../types";
import { stagePercent, throttleProgress, type LoadProgress } from "../load-progress";
import { buildCategories, buildOverview, ensureF10Ready, getCachedF10, loadQuotes, mergeRow } from "./market-service";

const KLINE_CONCURRENCY = 24;
const NAV_CONCURRENCY = 20;
const NAV_TIMEOUT_MS = 8000;
const NAV_ATTEMPTS = 2;
const KLINE_LIMIT = 280;
const TRADE_DATE_LIMIT = 800;
const TRADE_DATES_TTL_MS = 6 * 60 * 60 * 1000;
const ANCHOR_SECID = "1.510300";
const CACHE_FILE_PREFIX = `prev-close-v${PREV_CLOSE_PAYLOAD_VERSION}`;

export async function resolvePrevTradeDate(now = Date.now()): Promise<string> {
  const today = shanghaiDateString(now);
  const allowEastMoney = await probeEastMoneyDailyKline(ANCHOR_SECID, 20);
  const { bars } = await fetchKlineWithSource(ANCHOR_SECID, 101, 20, { allowEastMoney });
  for (let i = bars.length - 1; i >= 0; i--) {
    if (bars[i].time < today) return bars[i].time;
  }
  throw new Error("无法从日 K 线确定上一交易日");
}

function emptyQuote(base: QuoteRaw, quoteTime: number): QuoteRaw {
  return {
    code: base.code,
    market: base.market,
    name: base.name,
    last: null,
    change: null,
    changePct: null,
    volume: null,
    turnover: null,
    amplitude: null,
    turnoverRate: null,
    volumeRatio: null,
    high: null,
    low: null,
    open: null,
    prevClose: null,
    bid1: null,
    ask1: null,
    listedDateRaw: base.listedDateRaw,
    quoteTime,
    ret5d: null,
    ret20d: null,
    ret60d: null,
    ret1y: null,
    ytdChangePct: null,
    statusHint: null,
  };
}

function hasTrade(bar: KlineBar): boolean {
  return (typeof bar.volume === "number" && bar.volume > 0) || (typeof bar.amount === "number" && bar.amount > 0);
}

function closePremiumFromNav(close: number | null, nav: number | null): number | null {
  if (close === null || nav === null || !Number.isFinite(close) || !Number.isFinite(nav) || nav === 0) return null;
  return ((close - nav) / nav) * 100;
}

function quoteFromBars(base: QuoteRaw, bars: KlineBar[], asOfDate: string, quoteTime: number): QuoteRaw {
  const bar = findBarOnDate(bars, asOfDate);
  if (!bar || !hasTrade(bar) || !Number.isFinite(bar.close)) {
    return emptyQuote(base, quoteTime);
  }
  const idx = bars.findIndex((b) => b.time === asOfDate);
  const prevBar = idx > 0 ? bars[idx - 1] : null;
  const prevClose = prevBar && Number.isFinite(prevBar.close) ? prevBar.close : null;
  let change = bar.change;
  let changePct = bar.changePct;
  if (change === null && prevClose !== null) change = Number((bar.close - prevClose).toFixed(6));
  if (changePct === null && prevClose) changePct = Number((((bar.close - prevClose) / prevClose) * 100).toFixed(4));
  return {
    code: base.code,
    market: base.market,
    name: base.name,
    last: bar.close,
    change,
    changePct,
    volume: Number.isFinite(bar.volume) ? bar.volume : null,
    turnover: Number.isFinite(bar.amount) ? bar.amount : null,
    amplitude: bar.amplitude,
    turnoverRate: bar.turnoverRate,
    volumeRatio: null,
    high: Number.isFinite(bar.high) ? bar.high : null,
    low: Number.isFinite(bar.low) ? bar.low : null,
    open: Number.isFinite(bar.open) ? bar.open : null,
    prevClose,
    bid1: null,
    ask1: null,
    listedDateRaw: base.listedDateRaw,
    quoteTime,
    ret5d: periodReturnFromBars(bars, asOfDate, 5),
    ret20d: periodReturnFromBars(bars, asOfDate, 20),
    ret60d: periodReturnFromBars(bars, asOfDate, 60),
    ret1y: yearReturnFromBars(bars, asOfDate),
    ytdChangePct: ytdChangePctFromBars(bars, asOfDate),
    statusHint: null,
  };
}

async function buildPrevClosePayload(asOfDate: string, klineLimit: number, onProgress?: (p: LoadProgress) => void): Promise<MarketPayload> {
  const provider = getMarketProvider();
  onProgress?.({
    stage: "universe",
    label: "正在准备基金列表…",
    done: 0,
    total: 1,
    percent: 4,
  });
  const universe = await loadQuotes();
  onProgress?.({
    stage: "universe",
    label: `已获取 ${universe.quotes.length} 只，正在补齐基金资料…`,
    done: 1,
    total: 1,
    percent: 8,
  });
  await ensureF10Ready(
    universe.quotes.map((q) => q.code),
    (done, total) =>
      onProgress?.({
        stage: "f10",
        label: "正在补齐基金资料（规模、运作费率、跟踪指数）…",
        done,
        total,
        percent: stagePercent(8, 15, done, total),
      }),
  );
  const quoteTime = shanghaiSessionCloseUnix(asOfDate);
  let klineOk = 0;
  let klineFail = 0;
  let klineFromTencent = 0;
  let klineFromEastMoney = 0;
  let traded = 0;
  let navOk = 0;
  const total = universe.quotes.length;
  const workTotal = Math.max(1, total * 2);
  let klineDone = 0;
  let navDone = 0;
  const reportKline = throttleProgress((p) => onProgress?.(p), 200);
  const emitWork = (label: string) => {
    const done = klineDone + navDone;
    reportKline({
      stage: "klines",
      label,
      done,
      total: workTotal,
      percent: stagePercent(15, 96, done, workTotal),
    });
  };
  reportKline({
    stage: "klines",
    label: "正在探测日K网关，随后并行拉取日K与当日净值…",
    done: 0,
    total: workTotal,
    percent: 15,
  });

  // 只探测一次：push2his 在部分出口会挂起；失败后进入 30 分钟冷却，全市场只走腾讯，不再逐只回打。
  const allowEastMoney = await probeEastMoneyDailyKline(ANCHOR_SECID, 20);
  emitWork(allowEastMoney ? "正在并行拉取日K与当日净值…" : "东方财富日K不可用，正在并行拉取腾讯日K与当日净值…");

  type KlineOutcome = {
    ok: boolean;
    bars: KlineBar[] | null;
    source: KlineFetchSource | null;
  };

  const klinePromise = mapPool(universe.quotes, KLINE_CONCURRENCY, async (base) => {
    const result: KlineOutcome = await fetchKlineWithSource(`${base.market}.${base.code}`, 101, klineLimit, {
      allowEastMoney,
    }).then(
      ({ bars, source }) => ({ ok: true, bars, source }),
      () => ({ ok: false, bars: null, source: null }),
    );
    klineDone += 1;
    emitWork("正在并行拉取日K与当日净值…");
    return result;
  });

  const navPromise = mapPool(universe.quotes, NAV_CONCURRENCY, async (base) => {
    const officialNav = await provider
      .fetchOfficialNav(base.code, asOfDate, { timeoutMs: NAV_TIMEOUT_MS, attempts: NAV_ATTEMPTS })
      .catch(() => null);
    navDone += 1;
    emitWork("正在并行拉取日K与当日净值…");
    return officialNav;
  });

  const [klineResults, officialNavs] = await Promise.all([klinePromise, navPromise]);

  const quotes = universe.quotes.map((base, i) => {
    const klineResult = klineResults[i];
    const officialNav = officialNavs[i] as OfficialNav | null;
    if (officialNav) navOk += 1;
    if (!klineResult?.ok || !klineResult.bars) {
      klineFail += 1;
      return { q: emptyQuote(base, quoteTime), officialNav };
    }
    klineOk += 1;
    if (klineResult.source === "tencent") klineFromTencent += 1;
    else klineFromEastMoney += 1;
    const q = quoteFromBars(base, klineResult.bars, asOfDate, quoteTime);
    if (q.last !== null) traded += 1;
    return { q, officialNav };
  });
  onProgress?.({
    stage: "assemble",
    label: "正在生成收盘快照…",
    done: 1,
    total: 1,
    percent: 98,
  });

  const list = quotes.map(({ q, officialNav }) => {
    const row = mergeRow(q, getCachedF10(q.code), undefined);
    const published = officialNav && officialNav.date === asOfDate ? officialNav.nav : null;
    const nav = alignOfficialNav(published, row.last, isMoneyMarketFund(row));
    const premium = closePremiumFromNav(row.last, nav);
    if (premium === null) {
      row.nav = null;
      row.navDate = null;
      row.premiumPct = null;
      return row;
    }
    row.nav = nav;
    row.navDate = asOfDate;
    row.premiumPct = premium;
    return row;
  });
  const f10Coverage = list.filter((x) => x.fundType).length;
  const navCoverage = list.filter((x) => x.nav !== null && x.premiumPct !== null).length;
  const notes = [
    `「历史市场」展示 ${asOfDate} 这一完整交易日的收盘行情，不是今天的实时报价。`,
    "可选日期为沪深300ETF（510300）日 K 中早于上海日历当天的交易日，会跳过周末与节假日，也不会把尚未收盘的今天当作历史行情。",
    klineFromTencent > 0
      ? klineFromEastMoney > 0
        ? "价格、涨跌、成交额/量、换手、开高低优先取自东方财富日 K（前复权 fqt=1）；部分品种因该网关不可用改用腾讯财经前复权日 K（newfqkline，qfq）。腾讯成交量单位为手，成交额已从万元换算为元。昨收为再前一交易日收盘价。买卖一档、价差、量比、IOPV 为盘中字段，收盘快照中显示为缺失。不会把腾讯最新价或昨收当作官方净值。"
        : "价格、涨跌、成交额/量、换手、开高低取自腾讯财经前复权日 K（newfqkline，qfq），因东方财富 push2his 日 K 暂时不可用而启用兜底。成交量单位为手，成交额已从万元换算为元。昨收为再前一交易日收盘价。买卖一档、价差、量比、IOPV 为盘中字段，收盘快照中显示为缺失。不会把腾讯最新价或昨收当作官方净值，也不会把今日市场的当日行情快照当作官方收盘磁带。"
      : "价格、涨跌、成交额/量、换手、开高低取自该日 K 线；昨收为再前一交易日收盘价。买卖一档、价差、量比、IOPV 为盘中字段，收盘快照中显示为缺失。",
    "收盘溢价率（净值）= (该日收盘价 − 当日基金份额净值) / 当日净值 × 100。净值取自东方财富基金历史净值接口 lsjz 的 DWJZ，且必须 FSRQ 等于该收盘日；不会用更早的净值、IOPV、昨收或估值去填补。收益结转型货币基金的 lsjz DWJZ 是每万份收益，收盘溢价改按官方单位净值 1.00 元对齐到与收盘价相同的报价单位（通常为每百份 100 元）；净值型货币仍用当日公布的单位净值。",
    "当日净值尚未公布的品种（跨境/QDII 常见为 T+1 才披露）收盘溢价显示为 —。今日市场的折溢价改用最新已公布净值，口径与常见券商一致，但也必须标注净值日期。",
    "今年涨跌幅按该日收盘价相对上一自然年最后交易日收盘价计算：(收盘价 / 上年最后收盘价) - 1；若当年上市、没有上年收盘，则用上市后最早收盘价。",
    "基金规模、运作费率、跟踪指数等资料来自 F10（规模为 NEW_SCALE 及披露日；运作费率 = DEC_GUANLIFEI + DEC_TUOGUANFEI），不是盘中跳动字段。",
    klineFromTencent > 0
      ? `日 K 覆盖 ${klineOk}/${list.length}（腾讯 ${klineFromTencent}，东方财富 ${klineFromEastMoney}），失败 ${klineFail} 只；有成交的收盘记录 ${traded} 只。失败或当日无成交量/成交额的品种按无行情展示，不会用今价或昨收填补。`
      : `日 K 覆盖 ${klineOk}/${list.length}，失败 ${klineFail} 只；有成交的收盘记录 ${traded} 只。失败或当日无成交量/成交额的品种按无行情展示，不会用今价或昨收填补。`,
    `净值覆盖 ${navCoverage}/${list.length}（同日 lsjz 返回 ${navOk} 只）；缺少同日净值或缺少有效收盘价时溢价为 —。`,
    "该快照按收盘日期缓存在服务端本地（内存与文件），同一日期再次打开会直接读取缓存，无需重复拉取。可在设置中查看、删除已缓存日期。",
  ];

  const payload: MarketPayload = {
    source:
      klineFromTencent > 0 && klineFromEastMoney === 0
        ? `腾讯财经前复权日K（历史收盘 ${asOfDate}）；基金资料与净值仍来自东方财富`
        : klineFromTencent > 0
          ? `东方财富公开行情 / 腾讯日K兜底（历史收盘 ${asOfDate}）`
          : `${provider.label}（历史收盘 ${asOfDate}）`,
    fetchedAt: Math.floor(Date.now() / 1000),
    quoteTime,
    freshness: "已收盘（日终行情）",
    delayed: false,
    f10Coverage,
    iopvCoverage: 0,
    navCoverage,
    payloadVersion: PREV_CLOSE_PAYLOAD_VERSION,
    notes,
    overview: buildOverview(list),
    categories: buildCategories(list.filter((x) => x.status !== "终止上市")),
    list,
    view: "prev-close",
    asOfDate,
  };
  onProgress?.({
    stage: "assemble",
    label: "收盘快照已就绪",
    done: 1,
    total: 1,
    percent: 100,
  });
  return payload;
}

let tradeDatesCache: { dates: string[]; updatedAt: number } | null = null;
const buildingByDate = new Map<string, Promise<MarketPayload>>();
const progressByDate = new Map<string, { listeners: Set<(p: LoadProgress) => void>; last: LoadProgress | null }>();

export async function listCompletedTradeDates(): Promise<string[]> {
  if (tradeDatesCache && Date.now() - tradeDatesCache.updatedAt < TRADE_DATES_TTL_MS) {
    return tradeDatesCache.dates;
  }
  const today = shanghaiDateString();
  const allowEastMoney = await probeEastMoneyDailyKline(ANCHOR_SECID, 20);
  const { bars } = await fetchKlineWithSource(ANCHOR_SECID, 101, TRADE_DATE_LIMIT, { allowEastMoney });
  const dates = bars.map((b) => b.time).filter((time) => time < today).sort((a, b) => b.localeCompare(a));
  if (!dates.length) throw new Error("无法从日 K 线确定已结束的交易日");
  tradeDatesCache = { dates, updatedAt: Date.now() };
  return dates;
}

export async function resolveHistoryDate(requested?: string | null): Promise<string> {
  const dates = await listCompletedTradeDates();
  if (!requested) return dates[0];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(requested)) throw new Error("日期格式无效，请使用 YYYY-MM-DD");
  if (!dates.includes(requested)) {
    throw new Error(`${requested} 不是已结束的沪深交易日，没有收盘行情可展示。`);
  }
  return requested;
}

function klineLimitForDate(asOfDate: string, tradeDates: string[]): number {
  const idx = tradeDates.indexOf(asOfDate);
  const fromToday = idx >= 0 ? idx + 1 : KLINE_LIMIT;
  return Math.min(TRADE_DATE_LIMIT, Math.max(KLINE_LIMIT, fromToday + 260));
}

function cacheFileName(asOfDate: string) {
  return `${CACHE_FILE_PREFIX}-${asOfDate}.json`;
}

function cacheMemKey(asOfDate: string) {
  return `${CACHE_FILE_PREFIX}:${asOfDate}`;
}

function isValidPayload(payload: MarketPayload | null, asOfDate: string): payload is MarketPayload {
  return Boolean(
    payload &&
      payload.asOfDate === asOfDate &&
      payload.payloadVersion === PREV_CLOSE_PAYLOAD_VERSION &&
      Array.isArray(payload.list) &&
      payload.list.length > 0,
  );
}

export function listHistoryCache(): HistoryCacheItem[] {
  const items = new Map<string, HistoryCacheItem>();
  for (const file of listCacheFiles(`${CACHE_FILE_PREFIX}-`)) {
    const match = file.name.match(new RegExp(`^${CACHE_FILE_PREFIX}-(\\d{4}-\\d{2}-\\d{2})\\.json$`));
    if (!match) continue;
    const date = match[1];
    const payload = readJsonFile<MarketPayload>(file.name);
    if (!isValidPayload(payload, date)) continue;
    items.set(date, {
      date,
      etfCount: payload.list.length,
      savedAt: payload.fetchedAt ?? Math.floor(file.mtimeMs / 1000),
      sizeBytes: file.size,
      kind: "close",
    });
  }
  return [...items.values()].sort((a, b) => b.date.localeCompare(a.date));
}

export function deleteHistoryCache(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  memoryDelete(cacheMemKey(date));
  return deleteCacheFile(cacheFileName(date));
}

export function deleteAllHistoryCache(): { deleted: number } {
  memoryDeleteByPrefix(`${CACHE_FILE_PREFIX}:`);
  let deleted = 0;
  for (const file of listCacheFiles(`${CACHE_FILE_PREFIX}-`)) {
    if (deleteCacheFile(file.name)) deleted += 1;
  }
  return { deleted };
}

export async function getHistoryPayload(requestedDate?: string | null, onProgress?: (p: LoadProgress) => void): Promise<MarketPayload> {
  onProgress?.({
    stage: "asOfDate",
    label: requestedDate ? `正在核对交易日 ${requestedDate}…` : "正在确定上一交易日…",
    done: 0,
    total: 1,
    percent: 1,
  });
  const tradeDates = await listCompletedTradeDates();
  const asOfDate = await resolveHistoryDate(requestedDate);
  onProgress?.({
    stage: "asOfDate",
    label: `收盘日期 ${asOfDate}，正在检查服务端缓存…`,
    done: 1,
    total: 1,
    percent: 3,
  });
  const memKey = cacheMemKey(asOfDate);
  const cached = memoryGet<MarketPayload>(memKey);
  if (isValidPayload(cached, asOfDate)) {
    onProgress?.({ stage: "cached", label: "已命中服务端缓存", done: 1, total: 1, percent: 100 });
    return cached;
  }
  const file = readJsonFile<MarketPayload>(cacheFileName(asOfDate));
  if (isValidPayload(file, asOfDate)) {
    memorySet(memKey, file);
    onProgress?.({ stage: "cached", label: "已命中服务端缓存", done: 1, total: 1, percent: 100 });
    return file;
  }
  const inflight = buildingByDate.get(asOfDate);
  if (inflight) {
    const slot = progressByDate.get(asOfDate);
    if (slot?.last) onProgress?.(slot.last);
    if (onProgress && slot) slot.listeners.add(onProgress);
    try {
      return await inflight;
    } finally {
      if (onProgress && slot) slot.listeners.delete(onProgress);
    }
  }
  const slot = { listeners: new Set<(p: LoadProgress) => void>(), last: null as LoadProgress | null };
  if (onProgress) slot.listeners.add(onProgress);
  progressByDate.set(asOfDate, slot);
  const emit = (p: LoadProgress) => {
    slot.last = p;
    for (const listener of slot.listeners) listener(p);
  };
  const build = buildPrevClosePayload(asOfDate, klineLimitForDate(asOfDate, tradeDates), emit)
    .then((payload) => {
      memorySet(memKey, payload);
      writeJsonFile(cacheFileName(asOfDate), payload);
      return payload;
    })
    .finally(() => {
      buildingByDate.delete(asOfDate);
      progressByDate.delete(asOfDate);
    });
  buildingByDate.set(asOfDate, build);
  try {
    return await build;
  } finally {
    if (onProgress) slot.listeners.delete(onProgress);
  }
}

export async function getPrevClosePayload(onProgress?: (p: LoadProgress) => void): Promise<MarketPayload> {
  return getHistoryPayload(null, onProgress);
}
