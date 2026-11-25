import { memoryGet, memorySet, readJsonFile, writeJsonFile } from "../cache";
import { classifyEtf, detectStatus } from "../classify";
import { buildRankBoards } from "../rank-boards";
import { buildThemeHotspots } from "../themes";
import { alignOfficialNav, isMoneyMarketFund, listedDateFromF26, operatingFeeOf, premiumFromNav } from "../format";
import { isTodaySessionQuote, liveSessionChange, marketFreshness, shanghaiDateString } from "../market-hours";
import { getMarketProvider } from "../providers";
import { fetchEtfTypeList } from "../providers/eastmoney";
import { UNIVERSE_AND_QUOTES_UNAVAILABLE, publicUpstreamMessage, UpstreamUnavailableError } from "../providers/errors";
import { fetchSinaEtfUniverse } from "../providers/sina";
import { fetchTencentQuotes, type QuoteSource, type UniverseItem, type UniverseSource } from "../providers/tencent";
import type { OfficialNav, QuoteRaw } from "../providers/types";
import type {
  CategoryStat,
  EtfCategory,
  EtfDetailPayload,
  EtfRow,
  FundProfile,
  IopvSnapshot,
  MarketPayload,
} from "../types";
import { ALL_CATEGORIES } from "../types";
import type { LoadProgress } from "../load-progress";
import { stagePercent } from "../load-progress";

const QUOTE_TTL_MS = 12_000;
const F10_TTL_MS = 18 * 60 * 60 * 1000;
const IOPV_TTL_MS = 45_000;
const NAV_TTL_MS = 6 * 60 * 60 * 1000;
const NAV_MISS_TTL_MS = 60 * 60 * 1000;
const NAV_CONCURRENCY = 10;
const F10_FILE = "f10-cache.json";
const IOPV_FILE = "iopv-cache.json";
const NAV_FILE = "official-nav-cache.json";

type F10Store = Record<string, FundProfile>;
type IopvStore = Record<string, IopvSnapshot>;
type OfficialNavEntry = {
  code: string;
  date: string | null;
  nav: number | null;
  updatedAt: number;
};
type NavStore = Record<string, OfficialNavEntry>;

let f10Memory: F10Store = readJsonFile<F10Store>(F10_FILE) ?? {};
let iopvMemory: IopvStore = readJsonFile<IopvStore>(IOPV_FILE) ?? {};
let navMemory: NavStore = readJsonFile<NavStore>(NAV_FILE) ?? {};
let f10Warming: Promise<void> | null = null;
let iopvWarming: Promise<void> | null = null;
let navWarming: Promise<void> | null = null;
type UniverseCache = {
  total: number;
  quotes: QuoteRaw[];
  fetchedAt: number;
  quoteSource: QuoteSource;
  universeSource: UniverseSource;
};

let lastSuccessfulUniverse: { total: number; items: UniverseItem[] } | null = null;
let universeInflight: Promise<UniverseCache> | null = null;


function hasSessionTrade(q: import("../providers/types").QuoteRaw): boolean {
  return (q.volume != null && q.volume > 0) || (q.turnover != null && q.turnover > 0) || q.open != null;
}

export function mergeRow(
  q: import("../providers/types").QuoteRaw,
  f10?: FundProfile,
  iopv?: IopvSnapshot,
  officialNav?: OfficialNav | OfficialNavEntry | null,
  opts?: { liveSession?: boolean; now?: number },
): EtfRow {
  let last = q.last;
  let change = q.change;
  let changePct = q.changePct;
  const status = detectStatus(q.name, last, q.statusHint);
  // 深市停牌时，clist 常把昨收原样填进最新价且成交量为空。这不是今价，不能展示成正在交易。
  if (status === "停牌" && !hasSessionTrade(q)) {
    last = null;
    change = null;
    changePct = null;
  }
  // 今日市场只展示当天会话的涨跌幅。开盘前（及商品/黄金 ETF）上游仍会返回上一交易日收盘涨跌，不能当作今日涨跌。
  // 历史市场不传 liveSession，继续使用该收盘日自己的涨跌。
  if (opts?.liveSession) {
    const live = liveSessionChange(change, changePct, q.quoteTime, opts.now);
    change = live.change;
    changePct = live.changePct;
  }
  const category = classifyEtf(f10 ?? null);
  const spread =
    q.ask1 !== null && q.bid1 !== null ? Number((q.ask1 - q.bid1).toFixed(6)) : null;
  const nav = alignOfficialNav(
    officialNav?.nav ?? null,
    last,
    isMoneyMarketFund({ category, fundType: f10?.fundType ?? null }),
  );
  return {
    code: q.code,
    name: q.name,
    market: q.market,
    secid: `${q.market}.${q.code}`,
    exchange: q.market === 1 ? "SH" : "SZ",
    category,
    status,
    last,
    change,
    changePct,
    turnover: q.turnover,
    volume: q.volume,
    amplitude: q.amplitude,
    turnoverRate: q.turnoverRate,
    volumeRatio: q.volumeRatio,
    high: q.high,
    low: q.low,
    open: q.open,
    prevClose: q.prevClose,
    bid1: q.bid1,
    ask1: q.ask1,
    spread,
    iopv: iopv?.iopv ?? null,
    nav,
    navDate: officialNav?.date ?? null,
    premiumPct: premiumFromNav(last, nav),
    listedDate: listedDateFromF26(q.listedDateRaw),
    quoteTime: q.quoteTime,
    ret5d: q.ret5d,
    ret20d: q.ret20d,
    ret60d: q.ret60d,
    ret1y: q.ret1y,
    ytdChangePct: q.ytdChangePct,
    fundType: f10?.fundType ?? null,
    level2Class: f10?.level2Class ?? null,
    indexCode: f10?.indexCode ?? null,
    indexName: f10?.indexName ?? null,
    benchmark: f10?.benchmark ?? null,
    managementFee: f10?.managementFee ?? null,
    custodyFee: f10?.custodyFee ?? null,
    operatingFee: operatingFeeOf(f10?.managementFee ?? null, f10?.custodyFee ?? null),
    foundDate: f10?.foundDate ?? null,
    orgName: f10?.orgName ?? null,
    fundManager: f10?.fundManager ?? null,
    trustee: f10?.trustee ?? null,
    aum: f10?.aum ?? null,
    aumDate: f10?.aumDate ?? null,
    trackingErrorTarget: f10?.trackingErrorTarget ?? null,
  };
}

function f10Fresh(p: FundProfile | undefined) {
  return Boolean(p && Date.now() - p.updatedAt < F10_TTL_MS);
}

export function getCachedF10(code: string): FundProfile | undefined {
  return f10Memory[code];
}

export async function ensureF10Ready(codes: string[], onProgress?: (done: number, total: number) => void) {
  const stale = codes.filter((c) => !f10Fresh(f10Memory[c])).length;
  if (stale === 0) {
    onProgress?.(codes.length, codes.length);
    return;
  }
  if (!f10Warming) {
    f10Warming = warmF10(codes).finally(() => {
      f10Warming = null;
    });
  }
  if (Object.keys(f10Memory).length < codes.length * 0.9) {
    const started = Date.now();
    const tick = () => {
      const fresh = codes.filter((c) => f10Fresh(f10Memory[c])).length;
      onProgress?.(fresh, codes.length);
    };
    tick();
    while (Date.now() - started < 55000 && Object.keys(f10Memory).length < codes.length * 0.9) {
      const inflight = f10Warming;
      if (!inflight) break;
      await Promise.race([inflight, new Promise((r) => setTimeout(r, 400))]);
      tick();
    }
  } else {
    onProgress?.(codes.filter((c) => Boolean(f10Memory[c])).length, codes.length);
  }
}

function iopvFresh(p: IopvSnapshot | undefined) {
  return Boolean(p && Date.now() - p.updatedAt < IOPV_TTL_MS);
}

function navFresh(p: OfficialNavEntry | undefined) {
  if (!p) return false;
  const ttl = p.nav === null || p.date === null ? NAV_MISS_TTL_MS : NAV_TTL_MS;
  return Date.now() - p.updatedAt < ttl;
}

export function getCachedOfficialNav(code: string): OfficialNavEntry | undefined {
  return navMemory[code];
}

async function warmOfficialNav(codes: string[], onProgress?: (done: number, total: number) => void) {
  const provider = getMarketProvider();
  const missing = codes.filter((c) => !navFresh(navMemory[c]));
  if (missing.length === 0) {
    onProgress?.(codes.length, codes.length);
    return;
  }
  const report = (done: number) => {
    const fresh = codes.filter((c) => navFresh(navMemory[c])).length;
    onProgress?.(fresh, codes.length);
  };
  report(0);
  for (let i = 0; i < missing.length; i += NAV_CONCURRENCY) {
    const batch = missing.slice(i, i + NAV_CONCURRENCY);
    const results = await Promise.allSettled(batch.map((code) => provider.fetchLatestOfficialNav(code)));
    results.forEach((res, idx) => {
      const code = batch[idx];
      const now = Date.now();
      if (res.status === "fulfilled" && res.value) {
        navMemory[code] = { code, date: res.value.date, nav: res.value.nav, updatedAt: now };
      } else if (res.status === "fulfilled") {
        navMemory[code] = { code, date: null, nav: null, updatedAt: now };
      }
    });
    if (i % 40 === 0) writeJsonFile(NAV_FILE, navMemory);
    report(i + batch.length);
  }
  writeJsonFile(NAV_FILE, navMemory);
  report(codes.length);
}

export async function ensureNavReady(codes: string[], onProgress?: (done: number, total: number) => void) {
  const stale = codes.filter((c) => !navFresh(navMemory[c])).length;
  if (stale === 0) {
    onProgress?.(codes.length, codes.length);
    return;
  }
  if (!navWarming) {
    navWarming = warmOfficialNav(codes).finally(() => {
      navWarming = null;
    });
  }
  const started = Date.now();
  const tick = () => {
    onProgress?.(codes.filter((c) => navFresh(navMemory[c])).length, codes.length);
  };
  tick();
  while (Date.now() - started < 180000) {
    const inflight = navWarming;
    if (!inflight) break;
    if (codes.filter((c) => navFresh(navMemory[c])).length >= codes.length * 0.95) break;
    await Promise.race([inflight, new Promise((r) => setTimeout(r, 400))]);
    tick();
  }
  tick();
}

async function warmF10(codes: string[]) {
  const provider = getMarketProvider();
  const missing = codes.filter((c) => !f10Fresh(f10Memory[c]));
  if (missing.length === 0) return;
  const chunk = 160;
  for (let i = 0; i < missing.length; i += chunk) {
    const part = missing.slice(i, i + chunk);
    try {
      const rows = await provider.fetchFundProfiles(part);
      for (const row of rows) f10Memory[row.code] = row;
      writeJsonFile(F10_FILE, f10Memory);
    } catch {
      // keep going; next refresh will retry remaining codes
    }
  }
}

async function warmIopv(rows: { code: string; secid: string }[], limit = 0) {
  const provider = getMarketProvider();
  const targets = rows.filter((r) => !iopvFresh(iopvMemory[r.code]));
  const sliced = limit > 0 ? targets.slice(0, limit) : targets;
  const concurrency = 8;
  for (let i = 0; i < sliced.length; i += concurrency) {
    const batch = sliced.slice(i, i + concurrency);
    const results = await Promise.allSettled(batch.map((r) => provider.fetchIopv(r.secid)));
    results.forEach((res, idx) => {
      if (res.status === "fulfilled") iopvMemory[batch[idx].code] = res.value;
    });
    if (i % 40 === 0) writeJsonFile(IOPV_FILE, iopvMemory);
  }
  writeJsonFile(IOPV_FILE, iopvMemory);
}

function ensureWarmers(codes: string[], secids: { code: string; secid: string }[]) {
  if (!f10Warming) {
    f10Warming = warmF10(codes).finally(() => {
      f10Warming = null;
    });
  }
  if (!iopvWarming) {
    iopvWarming = warmIopv(secids).finally(() => {
      iopvWarming = null;
    });
  }
}

export function buildCategories(list: EtfRow[]): CategoryStat[] {
  return ALL_CATEGORIES.map((category) => {
    const items = list.filter((x) => x.category === category);
    const withPx = items.filter((x) => x.changePct !== null);
    const up = withPx.filter((x) => (x.changePct ?? 0) > 0).length;
    const down = withPx.filter((x) => (x.changePct ?? 0) < 0).length;
    const flat = withPx.filter((x) => (x.changePct ?? 0) === 0).length;
    const turnover = items.reduce((s, x) => s + (x.turnover ?? 0), 0);
    let weightedNum = 0;
    let weightedDen = 0;
    let eq = 0;
    let eqN = 0;
    for (const x of items) {
      if (x.changePct === null) continue;
      eq += x.changePct;
      eqN += 1;
      if (x.turnover && x.turnover > 0) {
        weightedNum += x.changePct * x.turnover;
        weightedDen += x.turnover;
      }
    }
    const representatives = [...items]
      .sort((a, b) => (b.turnover ?? -1) - (a.turnover ?? -1))
      .slice(0, 3)
      .map((x) => ({
        code: x.code,
        name: x.name,
        changePct: x.changePct,
        turnover: x.turnover,
      }));
    return {
      category,
      count: items.length,
      up,
      down,
      flat,
      turnover,
      weightedReturn: weightedDen > 0 ? weightedNum / weightedDen : null,
      equalReturn: eqN > 0 ? eq / eqN : null,
      representatives,
    };
  });
}

export function buildOverview(list: EtfRow[]): MarketPayload["overview"] {
  const active = list.filter((x) => x.status !== "终止上市");
  const withPx = active.filter((x) => x.changePct !== null);
  const aumItems = active.filter((x) => x.aum !== null);
  const ranks = buildRankBoards(active);
  const cats = buildCategories(active);
  const hotspots = buildThemeHotspots(active).map((c) => ({
    theme: c.theme,
    weightedReturn: c.weightedReturn,
    excessReturn: c.excessReturn,
    volumeRatio: c.volumeRatio,
    turnover: c.turnover,
    count: c.count,
    up: c.up,
    down: c.down,
  }));
  return {
    totalCount: list.length,
    listedCount: list.filter((x) => x.status === "正常上市").length,
    haltedCount: list.filter((x) => x.status === "停牌").length,
    pausedCount: list.filter((x) => x.status === "暂停交易").length,
    delistedCount: list.filter((x) => x.status === "终止上市").length,
    noQuoteCount: list.filter((x) => x.status === "无行情").length,
    totalAum: aumItems.reduce((s, x) => s + (x.aum ?? 0), 0),
    aumCoverage: aumItems.length,
    totalTurnover: active.reduce((s, x) => s + (x.turnover ?? 0), 0),
    up: withPx.filter((x) => (x.changePct ?? 0) > 0).length,
    down: withPx.filter((x) => (x.changePct ?? 0) < 0).length,
    flat: withPx.filter((x) => (x.changePct ?? 0) === 0).length,
    topGainers: ranks.topGainers,
    topLosers: ranks.topLosers,
    topVolumeUp: ranks.topVolumeUp,
    topVolumeDown: ranks.topVolumeDown,
    hotspots,
  };
}

function rememberUniverse(quotes: QuoteRaw[], total: number) {
  lastSuccessfulUniverse = {
    total,
    items: quotes.map((q) => ({ code: q.code, market: q.market, name: q.name })),
  };
}


function describeLiveSource(quoteSource?: QuoteSource, universeSource?: UniverseSource): string {
  if (quoteSource !== "tencent") return getMarketProvider().label;
  if (universeSource === "sina") {
    return "腾讯行情（实时报价）；名单来自新浪基金 ETF 节点（可能少于全市场）；基金资料与净值仍来自东方财富";
  }
  if (universeSource === "memory") {
    return "腾讯行情（实时报价）；名单来自上次成功的列表缓存；基金资料与净值仍来自东方财富";
  }
  return "腾讯行情（实时报价）；名单来自东方财富 ETF 列表；基金资料与净值仍来自东方财富";
}

async function resolveFallbackUniverse(
  onProgress?: (done: number, total: number) => void,
): Promise<{ total: number; items: UniverseItem[]; universeSource: UniverseSource } | null> {
  try {
    const typelist = await fetchEtfTypeList(onProgress);
    if (typelist.items.length > 0) {
      return { ...typelist, universeSource: "eastmoney-typelist" };
    }
  } catch (err) {
    console.error("[market] typelist universe failed", err);
  }
  if (lastSuccessfulUniverse && lastSuccessfulUniverse.items.length > 0) {
    onProgress?.(1, 1);
    return { ...lastSuccessfulUniverse, universeSource: "memory" };
  }
  try {
    const sina = await fetchSinaEtfUniverse(onProgress);
    if (sina.items.length > 0) {
      return { ...sina, universeSource: "sina" };
    }
  } catch (err) {
    console.error("[market] sina universe failed", err);
  }
  return null;
}

export async function loadQuotes(onProgress?: (done: number, total: number) => void) {
  const cached = memoryGet<UniverseCache>("universe");
  if (cached) {
    onProgress?.(1, 1);
    return cached;
  }
  if (!universeInflight) {
    universeInflight = (async () => {
      try {
        const data = await getMarketProvider().fetchUniverse(onProgress);
        rememberUniverse(data.quotes, data.total);
        const wrapped: UniverseCache = {
          ...data,
          fetchedAt: Date.now(),
          quoteSource: "eastmoney",
          universeSource: "eastmoney-clist",
        };
        memorySet("universe", wrapped, QUOTE_TTL_MS);
        return wrapped;
      } catch (err) {
        console.error("[market] East Money push2/clist failed", publicUpstreamMessage(err), err);
        const fallback = await resolveFallbackUniverse(onProgress);
        if (!fallback) {
          throw new UpstreamUnavailableError(UNIVERSE_AND_QUOTES_UNAVAILABLE, { cause: err });
        }
        try {
          const quotes = await fetchTencentQuotes(fallback.items);
          rememberUniverse(quotes, fallback.total);
          const wrapped: UniverseCache = {
            total: fallback.total,
            quotes,
            fetchedAt: Date.now(),
            quoteSource: "tencent",
            universeSource: fallback.universeSource,
          };
          memorySet("universe", wrapped, QUOTE_TTL_MS);
          return wrapped;
        } catch (tencentErr) {
          console.error("[market] Tencent quote fallback failed", tencentErr);
          throw new UpstreamUnavailableError(UNIVERSE_AND_QUOTES_UNAVAILABLE, { cause: tencentErr });
        }
      }
    })().finally(() => {
      universeInflight = null;
    });
  }
  return universeInflight;
}

function buildLivePayload(quotes: {
  quotes: QuoteRaw[];
  fetchedAt: number;
  quoteSource?: QuoteSource;
  universeSource?: UniverseSource;
}): MarketPayload {
  const list = quotes.quotes.map((q) => mergeRow(q, f10Memory[q.code], iopvMemory[q.code], navMemory[q.code], { liveSession: true }));
  const f10Coverage = list.filter((x) => x.fundType).length;
  const iopvCoverage = list.filter((x) => x.iopv !== null).length;
  const navCoverage = list.filter((x) => x.nav !== null && x.navDate !== null).length;
  const quoteTimes = list.map((x) => x.quoteTime).filter((x): x is number => x !== null);
  const quoteTime = quoteTimes.length ? Math.max(...quoteTimes) : null;
  const { freshness, delayed } = marketFreshness();
  const tencentFallback = quotes.quoteSource === "tencent";
  const universeNote =
    quotes.universeSource === "sina"
      ? "ETF 名单来自新浪基金节点 etf_hq_fund，覆盖可能少于东方财富全市场列表。"
      : quotes.universeSource === "memory"
        ? "ETF 名单来自进程内存中上次成功拉取的列表缓存。"
        : "ETF 名单来自东方财富 datacenter-web RPT_FUND_ETFLIST（代码、名称、市场），不是 push2 实时列表。";
  const notes = tencentFallback
    ? [
        "实时报价来自腾讯财经公开接口，因东方财富 push2 行情列表暂时不可用而启用兜底；不是交易所官方实时馈送。",
        universeNote,
        "折溢价仍只使用东方财富官方公布净值（lsjz 的 DWJZ）；缺少官方净值时折溢价显示为缺失，不会用腾讯最新价、昨收或 typelist 净值字段代替。",
        "年初至今涨跌幅、近 5/20/60 日与近一年涨跌幅、停牌标记、上市日期等依赖东方财富 clist 的字段，兜底行情中可能为空。量比在腾讯报价中有值时会使用（已与东方财富抽样核对）。",
        "基金规模、运作费率、跟踪指数来自东方财富 F10（若本次或缓存中已有）；尚未获取的显示为缺失。",
        "IOPV 仍来自东方财富 stock/get 的 f71（若缓存中有），仅作盘中参考，不参与折溢价。",
      ]
    : [
    "数据来源为东方财富公开行情，不是交易所官方实时馈送。",
    "基金规模取自 F10 NEW_SCALE，并标注披露日；不是现价×份额。",
    "折溢价 = (最新价 − 最新公布的基金份额净值) / 净值 × 100，与常见券商软件口径一致。净值取自东方财富基金历史净值接口 lsjz 的最新一条 DWJZ，并标注净值日期；不会用 IOPV、stock/get 的 f131、昨收或估值填补。收益结转型货币基金的 lsjz DWJZ 实际是每万份收益，不能直接与市价相比；这类基金官方单位净值恒为 1.00 元，折溢价按与市价相同的报价单位对齐（二级市场通常为每百份 100 元）。净值型货币（如银华日利）仍直接使用公布的单位净值。",
    "跨境/QDII 净值常滞后 1–2 个交易日，此时折溢价反映的是市价相对已公布净值的偏离，不是相对盘中 IOPV 的偏离。IOPV 仍单独展示，不参与折溢价。",
    "成交额、份额变化均不等于资金净流入。",
    "已实现跟踪误差暂无法从公开接口获取；如有数字仅为合同目标。",
    "今年涨跌幅取自东方财富 clist f25（年初至今），与日 K 按「上年最后交易日收盘价」计算的结果一致；抽样核验过 f127 并不是今年以来，故未使用。原「近一年涨跌幅」列仍映射 f25，今日市场中会与今年涨跌幅相同。",
    "运作费率 = 管理费率 + 托管费率（F10 DEC_GUANLIFEI + DEC_TUOGUANFEI），单位为年费率百分比；未核实到销售服务费字段，不另加该项。管理费或托管费缺失时运作费率显示为缺失。",
    "放量上涨/放量下跌榜仅纳入量比≥1.50 的品种，再按涨跌幅排序；量比来自东方财富 clist f10（相对近 5 日同时段均量）。量比缺失或不足 1.50 的不进入榜单，不会用成交额或换手率顶替。历史收盘快照没有盘中量比，该榜不展示。",
    "热点主题按跟踪指数、基准和基金名称归入更细主题（如半导体、港股科技、红利），再按成交额加权涨跌幅排序；至少 5 只且能算出加权涨跌幅的主题才进入榜单，不会把「其他主题」算作热点。分类依据公开资料字段，不是官方行业分类。",
  ];
  if (navCoverage < list.length) {
    notes.push(`净值覆盖 ${navCoverage}/${list.length}；缺少已公布净值或缺少有效最新价时折溢价显示为缺失，不会用 IOPV 或昨收代替。`);
  }
  if (iopvCoverage < list.length) {
    notes.push(`IOPV 缓存覆盖 ${iopvCoverage}/${list.length}，仅用于 IOPV 列与详情展示，不参与折溢价。`);
  }
  if (f10Coverage < list.length) {
    notes.push(`基金资料覆盖 ${f10Coverage}/${list.length}；极少数无法归入宽基/行业/主题/跨境/商品/债券/货币的品种不再单列「其他」，只出现在全市场列表中，不会仅按名称强行分类。`);
  }
  const staleChange = list.filter((x) => x.changePct === null && !isTodaySessionQuote(x.quoteTime)).length;
  if (staleChange > 0) {
    notes.push(
      `涨跌幅只展示上海日历当天、且行情时间已进入 09:15 及之后的报价；当前有 ${staleChange}/${list.length} 只尚无今日会话行情（开盘前上游常仍挂昨日收盘涨跌，商品/黄金 ETF 同样如此），涨跌幅显示为缺失，不会用昨日收盘涨跌、IOPV、净值或商品现货隔夜波动代替。`,
    );
  }
  return {
    source: describeLiveSource(quotes.quoteSource, quotes.universeSource),
    fetchedAt: Math.floor(quotes.fetchedAt / 1000),
    quoteTime,
    freshness,
    delayed,
    f10Coverage,
    iopvCoverage,
    navCoverage,
    notes,
    overview: buildOverview(list),
    categories: buildCategories(list.filter((x) => x.status !== "终止上市")),
    list,
    view: "live",
    asOfDate: null,
  };
}

export async function getMarketPayload(
  onProgress?: (p: LoadProgress) => void,
  onPartial?: (payload: MarketPayload) => void,
): Promise<MarketPayload> {
  onProgress?.({
    stage: "universe",
    label: "正在拉取沪深场内 ETF 行情列表…",
    done: 0,
    total: 1,
    percent: 5,
  });
  const quotes = await loadQuotes((done, total) => {
    onProgress?.({
      stage: "universe",
      label: total > 1 ? `正在拉取沪深场内 ETF 行情列表（${done}/${total} 页）…` : "正在拉取沪深场内 ETF 行情列表…",
      done,
      total,
      percent: 5 + Math.round((10 * done) / Math.max(total, 1)),
    });
  });
  onProgress?.({
    stage: "universe",
    label: `已获取 ${quotes.quotes.length} 只行情，正在检查基金资料…`,
    done: 1,
    total: 1,
    percent: 15,
  });
  onPartial?.(buildLivePayload(quotes));
  const codes = quotes.quotes.map((q) => q.code);
  await ensureF10Ready(codes, (done, total) => {
    onProgress?.({
      stage: "f10",
      label: "正在补齐基金资料（规模、运作费率、跟踪指数）…",
      done,
      total,
      percent: stagePercent(15, 40, done, total),
    });
  });
  onPartial?.(buildLivePayload(quotes));
  await ensureNavReady(codes, (done, total) => {
    onProgress?.({
      stage: "nav",
      label: "正在拉取最新公布的基金份额净值…",
      done,
      total,
      percent: stagePercent(40, 94, done, total),
    });
  });
  ensureWarmers(
    codes,
    quotes.quotes.map((q) => ({ code: q.code, secid: `${q.market}.${q.code}` })),
  );
  onProgress?.({
    stage: "assemble",
    label: "正在整理全市场行情…",
    done: 1,
    total: 1,
    percent: 96,
  });
  const payload = buildLivePayload(quotes);
  onProgress?.({
    stage: "assemble",
    label: "行情已就绪",
    done: 1,
    total: 1,
    percent: 100,
  });
  return payload;
}

function riskWarnings(row: EtfRow): { level: "info" | "warn"; text: string }[] {
  const out: { level: "info" | "warn"; text: string }[] = [];
  if (row.category === "跨境") {
    out.push({
      level: "warn",
      text: "跨境/QDII：IOPV 与基金份额净值可能因海外市场时差、休市或汇率而滞后，请勿将净值当作盘中 IOPV。",
    });
  }
  if (row.premiumPct !== null && Math.abs(row.premiumPct) >= 1) {
    out.push({
      level: "warn",
      text: `折溢价约 ${row.premiumPct.toFixed(2)}%，偏离较大，请结合净值日期与流动性判断。`,
    });
  }
  if (row.navDate) {
    const today = shanghaiDateString();
    const navMs = Date.parse(`${row.navDate}T00:00:00+08:00`);
    const todayMs = Date.parse(`${today}T00:00:00+08:00`);
    if (Number.isFinite(navMs) && Number.isFinite(todayMs)) {
      const daysBehind = Math.round((todayMs - navMs) / 86_400_000);
      if (daysBehind >= 1) {
        out.push({
          level: "info",
          text: `折溢价所用净值日期为 ${row.navDate}，已滞后 ${daysBehind} 个自然日，跨境/QDII 品种较常见；这是相对已公布净值的偏离，不是相对盘中 IOPV 的偏离。`,
        });
      }
    }
  }
  if (row.turnover !== null && row.turnover < 1_000_000) {
    out.push({ level: "warn", text: "成交额低于 100 万元，流动性较差，买卖冲击成本可能较高。" });
  } else if (row.turnover !== null && row.turnover < 10_000_000) {
    out.push({ level: "info", text: "成交额低于 1000 万元，短线交易需注意流动性。" });
  }
  if (row.last && row.spread !== null && row.last > 0 && row.spread / row.last >= 0.003) {
    out.push({
      level: "warn",
      text: `买卖价差 ${row.spread.toFixed(3)}（约占最新价 ${((row.spread / row.last) * 100).toFixed(2)}%），价差偏大。`,
    });
  }
  if (row.trackingErrorTarget) {
    const num = Number((row.trackingErrorTarget.match(/(\d+(?:\.\d+)?)\s*%/) ?? [])[1]);
    if (Number.isFinite(num) && num > 2) {
      out.push({
        level: "warn",
        text: `合同约定年化跟踪误差目标为「${row.trackingErrorTarget}」，高于常见股票 ETF 的 2% 目标；这不是已实现跟踪误差。`,
      });
    } else {
      out.push({
        level: "info",
        text: `跟踪误差仅有合同目标：「${row.trackingErrorTarget}」，公开接口暂无已实现跟踪误差。`,
      });
    }
  }
  if (row.status === "停牌") {
    out.push({
      level: "warn",
      text:
        row.last == null
          ? "当前交易状态：停牌，今日尚未成交，价格按缺失展示，不会用昨收填补。"
          : "当前交易状态：停牌，最新价为停牌前最后成交价。",
    });
  } else if (row.status === "无行情" || row.status === "暂停交易") {
    out.push({ level: "warn", text: `当前交易状态：${row.status}，价格字段按缺失展示，不会用 0 填充。` });
  }
  return out;
}

export async function getEtfDetail(code: string, marketHint?: number): Promise<EtfDetailPayload> {
  const provider = getMarketProvider();
  const universe = await loadQuotes();
  let quote = universe.quotes.find((q) => q.code === code);
  const market = (marketHint === 0 || marketHint === 1 ? marketHint : quote?.market) ?? guessMarket(code);
  const secid = `${market}.${code}`;
  const [iopv, profile, officialNav] = await Promise.all([
    provider.fetchIopv(secid),
    f10Fresh(f10Memory[code]) ? Promise.resolve(f10Memory[code]) : provider.fetchFundProfile(code),
    navFresh(navMemory[code])
      ? Promise.resolve(
          navMemory[code].nav !== null && navMemory[code].date
            ? { code, date: navMemory[code].date as string, nav: navMemory[code].nav as number }
            : null,
        )
      : provider.fetchLatestOfficialNav(code).catch(() => null),
  ]);
  if (profile) {
    f10Memory[code] = profile;
    writeJsonFile(F10_FILE, f10Memory);
  }
  iopvMemory[code] = iopv;
  navMemory[code] = officialNav
    ? { code, date: officialNav.date, nav: officialNav.nav, updatedAt: Date.now() }
    : { code, date: null, nav: null, updatedAt: Date.now() };
  writeJsonFile(NAV_FILE, navMemory);
  if (!quote) {
    quote = {
      code,
      market,
      name: profile?.name ?? code,
      last: iopv.last,
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
      listedDateRaw: null,
      quoteTime: iopv.quoteTime,
      ret5d: null,
      ret20d: null,
      ret60d: null,
      ret1y: null,
      ytdChangePct: null,
      statusHint: null,
    };
  }
  const row = mergeRow(quote, profile ?? f10Memory[code], iopv, navMemory[code], { liveSession: true });
  const { freshness, delayed } = marketFreshness();
  return {
    source: describeLiveSource(universe.quoteSource, universe.universeSource),
    fetchedAt: Math.floor(Date.now() / 1000),
    freshness,
    delayed,
    row,
    iopvQuoteTime: iopv.quoteTime,
    notes: [
      "折溢价 = (最新价 − 最新公布基金份额净值) / 净值，净值来自东方财富 lsjz 的 DWJZ，并标注净值日期。",
      "IOPV 来自 stock/get 的 f71，仅作盘中参考，不用于折溢价。stock/get 的 f131 也不用于折溢价。",
    ],
    warnings: riskWarnings(row),
  };
}

export function guessMarket(code: string): 0 | 1 {
  return code.startsWith("5") ? 1 : 0;
}

export async function getKline(code: string, klt: 101 | 102 | 103, marketHint?: number) {
  const market = marketHint === 0 || marketHint === 1 ? marketHint : guessMarket(code);
  return getMarketProvider().fetchKline(`${market}.${code}`, klt);
}

export async function getTrends(code: string, marketHint?: number) {
  const market = marketHint === 0 || marketHint === 1 ? marketHint : guessMarket(code);
  return getMarketProvider().fetchTrends(`${market}.${code}`);
}
