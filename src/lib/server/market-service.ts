import { memoryGet, memorySet, readJsonFile, writeJsonFile } from "../cache";
import { classifyEtf, detectStatus } from "../classify";
import { listedDateFromF26 } from "../format";
import { marketFreshness } from "../market-hours";
import { getMarketProvider } from "../providers";
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

const QUOTE_TTL_MS = 12_000;
const F10_TTL_MS = 18 * 60 * 60 * 1000;
const IOPV_TTL_MS = 45_000;
const F10_FILE = "f10-cache.json";
const IOPV_FILE = "iopv-cache.json";

type F10Store = Record<string, FundProfile>;
type IopvStore = Record<string, IopvSnapshot>;

let f10Memory: F10Store = readJsonFile<F10Store>(F10_FILE) ?? {};
let iopvMemory: IopvStore = readJsonFile<IopvStore>(IOPV_FILE) ?? {};
let f10Warming: Promise<void> | null = null;
let iopvWarming: Promise<void> | null = null;

function premiumPct(last: number | null, iopv: number | null): number | null {
  if (last === null || iopv === null || iopv === 0) return null;
  return ((last - iopv) / iopv) * 100;
}

function mergeRow(q: import("../providers/types").QuoteRaw, f10?: FundProfile, iopv?: IopvSnapshot): EtfRow {
  const last = q.last;
  const category = classifyEtf(f10 ?? null);
  const spread =
    q.ask1 !== null && q.bid1 !== null ? Number((q.ask1 - q.bid1).toFixed(6)) : null;
  return {
    code: q.code,
    name: q.name,
    market: q.market,
    secid: `${q.market}.${q.code}`,
    exchange: q.market === 1 ? "SH" : "SZ",
    category,
    status: detectStatus(q.name, last),
    last,
    change: q.change,
    changePct: q.changePct,
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
    nav: iopv?.nav ?? null,
    premiumPct: premiumPct(last, iopv?.iopv ?? null),
    listedDate: listedDateFromF26(q.listedDateRaw),
    quoteTime: q.quoteTime,
    ret5d: q.ret5d,
    ret20d: q.ret20d,
    ret60d: q.ret60d,
    ret1y: q.ret1y,
    fundType: f10?.fundType ?? null,
    level2Class: f10?.level2Class ?? null,
    indexCode: f10?.indexCode ?? null,
    indexName: f10?.indexName ?? null,
    benchmark: f10?.benchmark ?? null,
    managementFee: f10?.managementFee ?? null,
    custodyFee: f10?.custodyFee ?? null,
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

function iopvFresh(p: IopvSnapshot | undefined) {
  return Boolean(p && Date.now() - p.updatedAt < IOPV_TTL_MS);
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

function buildCategories(list: EtfRow[]): CategoryStat[] {
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

function buildOverview(list: EtfRow[]): MarketPayload["overview"] {
  const active = list.filter((x) => x.status !== "终止上市");
  const withPx = active.filter((x) => x.changePct !== null);
  const aumItems = active.filter((x) => x.aum !== null);
  const sortable = active.filter((x) => x.status === "正常上市" || x.status === "无行情");
  const byRet = [...withPx].sort((a, b) => (b.changePct ?? 0) - (a.changePct ?? 0));
  const byTurnover = [...sortable].sort((a, b) => (b.turnover ?? 0) - (a.turnover ?? 0));
  const cats = buildCategories(active);
  const hotspots = [...cats]
    .filter((c) => c.count > 0)
    .sort((a, b) => (b.weightedReturn ?? -999) - (a.weightedReturn ?? -999))
    .slice(0, 4)
    .map((c) => ({
      category: c.category,
      weightedReturn: c.weightedReturn,
      turnover: c.turnover,
      count: c.count,
    }));
  return {
    totalCount: list.length,
    listedCount: list.filter((x) => x.status === "正常上市").length,
    pausedCount: list.filter((x) => x.status === "暂停交易").length,
    delistedCount: list.filter((x) => x.status === "终止上市").length,
    noQuoteCount: list.filter((x) => x.status === "无行情").length,
    totalAum: aumItems.reduce((s, x) => s + (x.aum ?? 0), 0),
    aumCoverage: aumItems.length,
    totalTurnover: active.reduce((s, x) => s + (x.turnover ?? 0), 0),
    up: withPx.filter((x) => (x.changePct ?? 0) > 0).length,
    down: withPx.filter((x) => (x.changePct ?? 0) < 0).length,
    flat: withPx.filter((x) => (x.changePct ?? 0) === 0).length,
    topGainers: byRet.slice(0, 5),
    topLosers: [...byRet].reverse().slice(0, 5),
    topTurnover: byTurnover.slice(0, 5),
    hotspots,
  };
}

async function loadQuotes() {
  const cached = memoryGet<{ total: number; quotes: import("../providers/types").QuoteRaw[]; fetchedAt: number }>(
    "universe",
  );
  if (cached) return cached;
  const provider = getMarketProvider();
  const data = await provider.fetchUniverse();
  const wrapped = { ...data, fetchedAt: Date.now() };
  memorySet("universe", wrapped, QUOTE_TTL_MS);
  return wrapped;
}

export async function getMarketPayload(): Promise<MarketPayload> {
  const quotes = await loadQuotes();
  const staleF10 = quotes.quotes.filter((q) => !f10Fresh(f10Memory[q.code])).length;
  if (staleF10 > 0) {
    if (!f10Warming) f10Warming = warmF10(quotes.quotes.map((q) => q.code)).finally(() => (f10Warming = null));
    if (Object.keys(f10Memory).length < quotes.quotes.length * 0.9) {
      await Promise.race([f10Warming, new Promise((r) => setTimeout(r, 55000))]);
    }
  }
  ensureWarmers(
    quotes.quotes.map((q) => q.code),
    quotes.quotes.map((q) => ({ code: q.code, secid: `${q.market}.${q.code}` })),
  );

  const list = quotes.quotes.map((q) => mergeRow(q, f10Memory[q.code], iopvMemory[q.code]));
  const f10Coverage = list.filter((x) => x.fundType).length;
  const iopvCoverage = list.filter((x) => x.iopv !== null).length;
  const quoteTimes = list.map((x) => x.quoteTime).filter((x): x is number => x !== null);
  const quoteTime = quoteTimes.length ? Math.max(...quoteTimes) : null;
  const { freshness, delayed } = marketFreshness();
  const notes = [
    "数据来源为东方财富公开行情，不是交易所官方实时馈送。",
    "基金规模取自 F10 NEW_SCALE，并标注披露日；不是现价×份额。",
    "折溢价 = (最新价 - IOPV) / IOPV。clist 不含 IOPV，由服务端缓存 stock/get 的 f71。",
    "基金份额净值 NAV（stock/get f131）不用于折溢价。跨境品种 IOPV/净值可能因时差滞后。",
    "成交额、份额变化均不等于资金净流入。",
    "已实现跟踪误差暂无法从公开接口获取；如有数字仅为合同目标。",
  ];
  if (iopvCoverage < list.length) {
    notes.push(`IOPV 缓存覆盖 ${iopvCoverage}/${list.length}，未覆盖品种折溢价显示为缺失，不会用净值或昨收代替。`);
  }
  if (f10Coverage < list.length) {
    notes.push(`基金资料覆盖 ${f10Coverage}/${list.length}，缺失资料的品种暂归入「其他」，不会仅按名称强行分类。`);
  }

  return {
    source: getMarketProvider().label,
    fetchedAt: Math.floor(quotes.fetchedAt / 1000),
    quoteTime,
    freshness,
    delayed,
    f10Coverage,
    iopvCoverage,
    notes,
    overview: buildOverview(list),
    categories: buildCategories(list.filter((x) => x.status !== "终止上市")),
    list,
  };
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
      text: `折溢价约 ${row.premiumPct.toFixed(2)}%，偏离较大，请结合 IOPV 时效与流动性判断。`,
    });
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
  if (row.status === "无行情" || row.status === "暂停交易") {
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
  const [iopv, profile] = await Promise.all([
    provider.fetchIopv(secid),
    f10Fresh(f10Memory[code]) ? Promise.resolve(f10Memory[code]) : provider.fetchFundProfile(code),
  ]);
  if (profile) {
    f10Memory[code] = profile;
    writeJsonFile(F10_FILE, f10Memory);
  }
  iopvMemory[code] = iopv;
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
      statusHint: null,
    };
  }
  const row = mergeRow(quote, profile ?? f10Memory[code], iopv);
  const { freshness, delayed } = marketFreshness();
  return {
    source: provider.label,
    fetchedAt: Math.floor(Date.now() / 1000),
    freshness,
    delayed,
    row,
    iopvQuoteTime: iopv.quoteTime,
    notes: [
      "IOPV 来自 stock/get 的 f71，基金份额净值来自 f131，二者不可互换。",
      "折溢价仅在 IOPV 有效时计算。",
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
