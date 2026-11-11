import { memoryGet, memorySet, readJsonFile, writeJsonFile } from "../cache";
import { PREV_CLOSE_PAYLOAD_VERSION } from "../prev-close-version";
import { shanghaiDateString, shanghaiSessionCloseUnix } from "../market-hours";
import { getMarketProvider } from "../providers";
import type { QuoteRaw } from "../providers/types";
import { findBarOnDate, periodReturnFromBars, yearReturnFromBars, ytdChangePctFromBars } from "../returns";
import type { KlineBar, MarketPayload } from "../types";
import { buildCategories, buildOverview, ensureF10Ready, getCachedF10, loadQuotes, mergeRow } from "./market-service";

const PREV_TTL_MS = 36 * 60 * 60 * 1000;
const KLINE_CONCURRENCY = 10;
const KLINE_LIMIT = 280;
const ANCHOR_SECID = "1.510300";
const CACHE_FILE_PREFIX = `prev-close-v${PREV_CLOSE_PAYLOAD_VERSION}`;

let building: Promise<MarketPayload> | null = null;
let buildingDate: string | null = null;

async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  }
  const n = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out;
}

export async function resolvePrevTradeDate(now = Date.now()): Promise<string> {
  const today = shanghaiDateString(now);
  const bars = await getMarketProvider().fetchKline(ANCHOR_SECID, 101, 20);
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

async function buildPrevClosePayload(asOfDate: string): Promise<MarketPayload> {
  const provider = getMarketProvider();
  const universe = await loadQuotes();
  await ensureF10Ready(universe.quotes.map((q) => q.code));
  const quoteTime = shanghaiSessionCloseUnix(asOfDate);
  let klineOk = 0;
  let klineFail = 0;
  let traded = 0;
  let navOk = 0;

  const quotes = await mapPool(universe.quotes, KLINE_CONCURRENCY, async (base) => {
    const [klineResult, officialNav] = await Promise.all([
      provider.fetchKline(`${base.market}.${base.code}`, 101, KLINE_LIMIT).then(
        (bars) => ({ ok: true as const, bars }),
        () => ({ ok: false as const, bars: null }),
      ),
      provider.fetchOfficialNav(base.code, asOfDate).catch(() => null),
    ]);
    if (officialNav) navOk += 1;
    if (!klineResult.ok || !klineResult.bars) {
      klineFail += 1;
      return { q: emptyQuote(base, quoteTime), officialNav };
    }
    klineOk += 1;
    const q = quoteFromBars(base, klineResult.bars, asOfDate, quoteTime);
    if (q.last !== null) traded += 1;
    return { q, officialNav };
  });

  const list = quotes.map(({ q, officialNav }) => {
    const row = mergeRow(q, getCachedF10(q.code), undefined);
    const nav = officialNav && officialNav.date === asOfDate ? officialNav.nav : null;
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
    `「上一日」展示 ${asOfDate} 这一完整交易日的收盘行情，不是今天的实时报价，也不会在收盘后改成当天。`,
    "上一交易日由沪深300ETF（510300）日 K 中「早于上海日历当天」的最后一根 K 线确定，会跳过周末与节假日。",
    "价格、涨跌、成交额/量、换手、开高低取自该日 K 线；昨收为再前一交易日收盘价。买卖一档、价差、量比、IOPV 为盘中字段，收盘快照中显示为缺失。",
    "收盘溢价率（净值）= (该日收盘价 − 当日基金份额净值) / 当日净值 × 100。净值取自东方财富基金历史净值接口 lsjz 的 DWJZ，且必须 FSRQ 等于该收盘日；不会用更早的净值、IOPV、昨收或估值去填补。",
    "当日净值尚未公布的品种（跨境/QDII 常见为 T+1 才披露）收盘溢价显示为 —。今日市场的折溢价仍只用盘中 IOPV，不会改用净值。",
    "今年涨跌幅按该日收盘价相对上一自然年最后交易日收盘价计算：(收盘价 / 上年最后收盘价) - 1；若当年上市、没有上年收盘，则用上市后最早收盘价。",
    "基金规模、运作费率、跟踪指数等资料来自 F10（规模为 NEW_SCALE 及披露日；运作费率 = DEC_GUANLIFEI + DEC_TUOGUANFEI），不是盘中跳动字段。",
    `日 K 覆盖 ${klineOk}/${list.length}，失败 ${klineFail} 只；有成交的收盘记录 ${traded} 只。失败或当日无成交量/成交额的品种按无行情展示，不会用今价或昨收填补。`,
    `净值覆盖 ${navCoverage}/${list.length}（同日 lsjz 返回 ${navOk} 只）；缺少同日净值或缺少有效收盘价时溢价为 —。`,
    "该快照按收盘日期缓存在服务端（内存与本地文件）以及浏览器本地，不按 15 秒轮询。",
  ];

  return {
    source: `${provider.label}（上一交易日收盘）`,
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
}

export async function getPrevClosePayload(): Promise<MarketPayload> {
  const asOfDate = await resolvePrevTradeDate();
  const memKey = `${CACHE_FILE_PREFIX}:${asOfDate}`;
  const cached = memoryGet<MarketPayload>(memKey);
  if (cached?.asOfDate === asOfDate && cached.payloadVersion === PREV_CLOSE_PAYLOAD_VERSION && cached.list?.length) return cached;
  const file = readJsonFile<MarketPayload>(`${CACHE_FILE_PREFIX}-${asOfDate}.json`);
  if (file?.asOfDate === asOfDate && file.payloadVersion === PREV_CLOSE_PAYLOAD_VERSION && file.list?.length) {
    memorySet(memKey, file, PREV_TTL_MS);
    return file;
  }
  if (building && buildingDate === asOfDate) return building;
  buildingDate = asOfDate;
  building = buildPrevClosePayload(asOfDate)
    .then((payload) => {
      memorySet(memKey, payload, PREV_TTL_MS);
      writeJsonFile(`${CACHE_FILE_PREFIX}-${asOfDate}.json`, payload);
      return payload;
    })
    .finally(() => {
      building = null;
      buildingDate = null;
    });
  return building;
}
