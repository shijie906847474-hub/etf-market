import { withHardTimeout } from "../async-pool";
import { extractTrackingErrorTarget } from "../classify";
import { parseFeePercent, toNum } from "../format";
import type { FundProfile, IopvSnapshot, KlineBar, TrendPoint } from "../types";
import { BOTH_KLINE_SOURCES_UNAVAILABLE, EASTMONEY_GATEWAY_UNAVAILABLE, isAbortLike, isNetworkFetchError, isTransientUpstreamError, UpstreamUnavailableError } from "./errors";
import { getCachedKline, setCachedKline, type KlineFetchSource } from "./kline-cache";
import { fetchTencentKline, type UniverseItem } from "./tencent";
import type { MarketDataProvider, OfficialNav, QuoteRaw } from "./types";

const PUSH_HOSTS = [
  "https://82.push2.eastmoney.com",
  "https://94.push2.eastmoney.com",
  "https://push2.eastmoney.com",
  "https://push2delay.eastmoney.com",
];

const HIS_HOSTS = [
  "https://push2his.eastmoney.com",
  "https://82.push2his.eastmoney.com",
  "https://82.push2.eastmoney.com",
];

const F10_URL = "https://datacenter-web.eastmoney.com/api/data/v1/get";
// MK0021 股票ETF, MK0022 货币ETF, MK0023 跨境ETF, MK0024 黄金ETF, MK0827 商品ETF, MK0828 债券ETF
const ETF_FS = "b:MK0021,b:MK0022,b:MK0023,b:MK0024,b:MK0827,b:MK0828";
const UT = "bd1d9ddb04089700cf9c27f6f7426281";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const LIST_FIELDS = [
  "f2",
  "f3",
  "f4",
  "f5",
  "f6",
  "f7",
  "f8",
  "f10",
  "f12",
  "f13",
  "f14",
  "f15",
  "f16",
  "f17",
  "f18",
  "f24",
  "f25",
  "f26",
  "f31",
  "f32",
  "f107",
  "f109",
  "f110",
  "f124",
].join(",");

const F10_COLUMNS = [
  "SECURITY_CODE",
  "SECURITY_NAME_ABBR",
  "FUND_TYPE",
  "LEVEL2_CLASSIF",
  "INDEXCODE",
  "INDEX_NAME_ABBR",
  "BENCHMARK",
  "DEC_GUANLIFEI",
  "DEC_TUOGUANFEI",
  "FOUND_DATE",
  "ORG_NAME",
  "FUND_MANAGER",
  "TRUSTEE",
  "NEW_SCALE",
  "NEW_SCALE_DATE",
  "NEW_SHARE",
  "NEW_SHARE_DATE",
  "OPERATE_WAY",
  "INVESTMENTSTRATEGY",
].join(",");

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

function throwFriendlyUpstream(url: string, err: unknown, status?: number): never {
  const host = hostOf(url);
  const statusPart = status != null ? `HTTP ${status}` : isAbortLike(err) ? "timeout/aborted" : "error";
  console.error(`[eastmoney] ${statusPart} ${host ?? url}`);
  throw new UpstreamUnavailableError(EASTMONEY_GATEWAY_UNAVAILABLE, {
    status: status ?? null,
    sourceHost: host,
    cause: err,
  });
}

async function fetchJson(url: string, timeoutMs = 20000, extraHeaders?: Record<string, string>): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      cache: "no-store",
      headers: {
        "User-Agent": UA,
        Referer: "https://quote.eastmoney.com/",
        Accept: "application/json,text/plain,*/*",
        ...extraHeaders,
      },
    });
    if (!res.ok) {
      if (res.status === 502 || res.status === 503) throwFriendlyUpstream(url, new Error(`HTTP ${res.status}`), res.status);
      console.error(`[eastmoney] HTTP ${res.status} ${hostOf(url) ?? url}`);
      throw new Error(`HTTP ${res.status}`);
    }
    return await res.json();
  } catch (err) {
    if (err instanceof UpstreamUnavailableError) throw err;
    if (isAbortLike(err) || isNetworkFetchError(err)) throwFriendlyUpstream(url, err);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

const lastGoodHost = new Map<string, string>();

function orderedHosts(hosts: string[]): string[] {
  const preferred = lastGoodHost.get(hosts.join("|"));
  if (!preferred || !hosts.includes(preferred)) return hosts;
  return [preferred, ...hosts.filter((h) => h !== preferred)];
}

async function fetchWithHosts(pathAndQuery: string, hosts: string[], timeoutMs = 20000): Promise<any> {
  let lastErr: unknown;
  const key = hosts.join("|");
  for (const host of orderedHosts(hosts)) {
    try {
      const data = await fetchJson(`${host}${pathAndQuery}`, timeoutMs);
      lastGoodHost.set(key, host);
      return data;
    } catch (err) {
      lastErr = err;
      // 上次好用的节点若开始 502/超时，立刻降级，下一页优先试其他节点。
      if (lastGoodHost.get(key) === host && isTransientUpstreamError(err)) {
        lastGoodHost.delete(key);
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

function mapQuote(row: Record<string, unknown>): QuoteRaw | null {
  const code = String(row.f12 ?? "");
  if (!/^\d{6}$/.test(code)) return null;
  const market = Number(row.f13) === 1 ? 1 : 0;
  return {
    code,
    market,
    name: String(row.f14 ?? ""),
    last: toNum(row.f2),
    change: toNum(row.f4),
    changePct: toNum(row.f3),
    volume: toNum(row.f5),
    turnover: toNum(row.f6),
    amplitude: toNum(row.f7),
    turnoverRate: toNum(row.f8),
    volumeRatio: toNum(row.f10),
    high: toNum(row.f15),
    low: toNum(row.f16),
    open: toNum(row.f17),
    prevClose: toNum(row.f18),
    bid1: toNum(row.f31),
    ask1: toNum(row.f32),
    listedDateRaw: (row.f26 as string | number | null) ?? null,
    quoteTime: toNum(row.f124),
    ret5d: toNum(row.f109),
    ret20d: toNum(row.f110),
    ret60d: toNum(row.f24),
    ret1y: toNum(row.f25),
    // 今年涨跌幅用 f25（东方财富「年初至今」）。2026-11-11 对 510300/159915/513100/513290
    // 用日 K fqt=1 按 (session_close / last_close_of_previous_year)-1 核对，与 f25 一致；
    // 同期 f127 为 -0.27/1.41/2.41/5.47，与该公式（约 -11.1/-21.0/16.1/25.3）不符，故不用 f127。
    ytdChangePct: toNum(row.f25),
    // clist f107：2=正常，5=停牌。不要用 stock/get 的 f107。
    statusHint: toNum(row.f107),
  };
}

function mapProfile(row: Record<string, unknown>): FundProfile {
  const strategy = row.INVESTMENTSTRATEGY != null ? String(row.INVESTMENTSTRATEGY) : null;
  return {
    code: String(row.SECURITY_CODE ?? ""),
    name: row.SECURITY_NAME_ABBR != null ? String(row.SECURITY_NAME_ABBR) : null,
    fundType: row.FUND_TYPE != null ? String(row.FUND_TYPE) : null,
    level2Class: row.LEVEL2_CLASSIF != null ? String(row.LEVEL2_CLASSIF) : null,
    indexCode: row.INDEXCODE != null ? String(row.INDEXCODE) : null,
    indexName: row.INDEX_NAME_ABBR != null ? String(row.INDEX_NAME_ABBR) : null,
    benchmark: row.BENCHMARK != null ? String(row.BENCHMARK) : null,
    managementFee: parseFeePercent(row.DEC_GUANLIFEI),
    custodyFee: parseFeePercent(row.DEC_TUOGUANFEI),
    foundDate: row.FOUND_DATE != null ? String(row.FOUND_DATE).slice(0, 10) : null,
    orgName: row.ORG_NAME != null ? String(row.ORG_NAME) : null,
    fundManager: row.FUND_MANAGER != null ? String(row.FUND_MANAGER) : null,
    trustee: row.TRUSTEE != null ? String(row.TRUSTEE) : null,
    aum: toNum(row.NEW_SCALE),
    aumDate: row.NEW_SCALE_DATE != null ? String(row.NEW_SCALE_DATE).slice(0, 10) : null,
    newShare: toNum(row.NEW_SHARE),
    newShareDate: row.NEW_SHARE_DATE != null ? String(row.NEW_SHARE_DATE).slice(0, 10) : null,
    operateWay: row.OPERATE_WAY != null ? String(row.OPERATE_WAY) : null,
    strategy,
    trackingErrorTarget: extractTrackingErrorTarget(strategy),
    updatedAt: Date.now(),
  };
}

export function looksLikeEtf(name: string): boolean {
  if (/LOF|FOF|REITs|REIT/i.test(name) && !/ETF/i.test(name)) return false;
  return true;
}


const TYPELIST_COLUMNS = "SECUCODE,SECURITY_CODE,SECURITY_NAME_ABBR,INDEX_NAME,YTD_CHANGE_RATE";
const TYPELIST_PAGE_SIZES = [200, 100];

/** 优先用 SECUCODE 后缀；否则 15xxxx→深市 0，51xxxx 或 5 开头→沪市 1。 */
export function marketFromEtfSecuCode(secucode: string | null | undefined, securityCode: string): 0 | 1 {
  const raw = String(secucode ?? "").trim().toUpperCase();
  const suffix = raw.includes(".") ? raw.slice(raw.lastIndexOf(".") + 1) : "";
  if (suffix === "SH") return 1;
  if (suffix === "SZ") return 0;
  if (/^15/.test(securityCode)) return 0;
  if (/^51/.test(securityCode) || /^5/.test(securityCode)) return 1;
  return 0;
}

export function parseTypeListRow(row: Record<string, unknown>): UniverseItem | null {
  const code = String(row.SECURITY_CODE ?? "").trim();
  if (!/^\d{6}$/.test(code)) return null;
  const name = String(row.SECURITY_NAME_ABBR ?? "").trim() || code;
  if (!looksLikeEtf(name)) return null;
  const secu = row.SECUCODE != null ? String(row.SECUCODE) : null;
  return { code, market: marketFromEtfSecuCode(secu, code), name };
}

export function parseTypeListPage(payload: unknown): { count: number; pages: number; items: UniverseItem[]; rawCount: number } {
  const body = payload as { success?: unknown; result?: { count?: unknown; pages?: unknown; data?: Record<string, unknown>[] } };
  if (!body || body.success !== true || !body.result) {
    throw new Error("东方财富 ETF 列表接口返回异常");
  }
  const rows = (body.result.data ?? []) as Record<string, unknown>[];
  const items: UniverseItem[] = [];
  for (const row of rows) {
    const item = parseTypeListRow(row);
    if (item) items.push(item);
  }
  const count = Number(body.result.count ?? 0);
  const pages = Number(body.result.pages ?? 0);
  return { count: Number.isFinite(count) ? count : 0, pages: Number.isFinite(pages) ? pages : 0, items, rawCount: rows.length };
}

async function fetchTypeListPage(pageNumber: number, pageSize: number): Promise<unknown> {
  const params = new URLSearchParams({
    sortColumns: "SECURITY_CODE",
    sortTypes: "1",
    pageSize: String(pageSize),
    pageNumber: String(pageNumber),
    reportName: "RPT_FUND_ETFLIST",
    columns: TYPELIST_COLUMNS,
    source: "WEB",
    client: "WEB",
  });
  return fetchJson(`${F10_URL}?${params.toString()}`, 20000, { Referer: "https://fund.eastmoney.com/" });
}

/**
 * 东方财富 datacenter-web RPT_FUND_ETFLIST 名单（代码、名称、市场）。
 * 不是实时行情；不要把列表里的净值字段当作官方单位净值。
 */
export async function fetchEtfTypeList(
  onProgress?: (done: number, total: number) => void,
): Promise<{ total: number; items: UniverseItem[] }> {
  let lastErr: unknown;
  let pageSize = TYPELIST_PAGE_SIZES[0];
  let first: ReturnType<typeof parseTypeListPage> | null = null;
  for (const size of TYPELIST_PAGE_SIZES) {
    try {
      const parsed = parseTypeListPage(await fetchTypeListPage(1, size));
      if (parsed.rawCount === 0 && parsed.count > 0) {
        lastErr = new Error(`东方财富 ETF 列表 pageSize=${size} 未返回数据`);
        continue;
      }
      pageSize = size;
      first = parsed;
      break;
    } catch (err) {
      lastErr = err;
      console.error(`[eastmoney] typelist pageSize=${size} failed`, err);
    }
  }
  if (!first) {
    throw lastErr instanceof Error ? lastErr : new Error("东方财富 ETF 列表暂时不可用");
  }

  const total = first.count;
  const pages = Math.max(first.pages || Math.ceil(Math.max(total, first.rawCount) / pageSize) || 1, 1);
  const rawByCode = new Map<string, UniverseItem>();
  let rawCount = 0;
  const consume = (page: ReturnType<typeof parseTypeListPage>) => {
    rawCount += page.rawCount;
    for (const item of page.items) rawByCode.set(item.code, item);
  };
  consume(first);
  onProgress?.(1, pages);

  for (let pn = 2; pn <= pages; pn++) {
    let page: ReturnType<typeof parseTypeListPage> | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        page = parseTypeListPage(await fetchTypeListPage(pn, pageSize));
        break;
      } catch (err) {
        lastErr = err;
        await sleep(250 * (attempt + 1));
      }
    }
    if (!page) {
      throw lastErr instanceof Error ? lastErr : new Error("东方财富 ETF 列表分页失败");
    }
    consume(page);
    onProgress?.(pn, pages);
  }

  if (total > 0 && rawCount < total && rawCount < total * 0.98) {
    throw new Error(`东方财富 ETF 列表不完整（${rawCount}/${total}），不会把截断名单当作全市场`);
  }
  const items = [...rawByCode.values()];
  return { total: total || items.length, items };
}


export function parseOfficialNavLsjz(payload: unknown, code: string, asOfDate: string): OfficialNav | null {
  const body = payload as { Data?: { LSJZList?: Record<string, unknown>[] } };
  const list = body?.Data?.LSJZList ?? [];
  const row = list.find((item) => String(item.FSRQ ?? "").slice(0, 10) === asOfDate);
  if (!row) return null;
  const nav = toNum(row.DWJZ);
  if (nav === null || nav === 0) return null;
  return { code, date: asOfDate, nav };
}

export type { KlineFetchSource } from "./kline-cache";

/** 冷却窗口要长于日期列表缓存与同实例二次打开历史市场的间隔，避免全市场再去打已挂掉的 push2his。 */
const EM_KLINE_COOLDOWN_MS = 30 * 60 * 1000;
const EM_KLINE_TIMEOUT_MS = 8000;
const EM_KLINE_PROBE_MS = 4000;
let emKlineCooldownUntil = 0;

function parseEastMoneyKlines(payload: any): KlineBar[] {
  const klines: string[] = payload?.data?.klines ?? [];
  return klines
    .map((line) => {
      const p = line.split(",");
      return {
        time: p[0],
        open: Number(p[1]),
        close: Number(p[2]),
        high: Number(p[3]),
        low: Number(p[4]),
        volume: Number(p[5]),
        amount: Number(p[6]),
        amplitude: toNum(p[7]),
        changePct: toNum(p[8]),
        change: toNum(p[9]),
        turnoverRate: toNum(p[10]),
      } satisfies KlineBar;
    })
    .filter((b) => Number.isFinite(b.open) && Number.isFinite(b.close));
}

async function fetchEastMoneyKline(secid: string, klt: 101 | 102 | 103, limit: number): Promise<KlineBar[]> {
  const payload = await fetchWithHosts(
    `/api/qt/stock/kline/get?secid=${encodeURIComponent(secid)}&klt=${klt}&fqt=1&lmt=${limit}&end=20500101&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61`,
    HIS_HOSTS,
    EM_KLINE_TIMEOUT_MS,
  );
  const bars = parseEastMoneyKlines(payload);
  if (bars.length === 0) throw new Error("东方财富日K未返回有效K线");
  return bars;
}

/**
 * 日/周/月 K：优先东方财富 push2his（前复权 fqt=1）。
 * 该网关在部分出口（含 Vercel hkg1）会 TLS 重置、挂起或抛出 fetch failed；失败后改用腾讯前复权日 K。
 * 进程内冷却后只走腾讯，不再在腾讯失败时逐只回打 push2his，以免把全市场拉取串行化。
 */
export type FetchKlineOptions = {
  /** 为 false 时跳过东方财富，直接走腾讯（历史收盘快照在探测失败后使用）。 */
  allowEastMoney?: boolean;
};

export function isEastMoneyKlineCooling(now = Date.now()): boolean {
  return now < emKlineCooldownUntil;
}

export function markEastMoneyKlineUnavailable(now = Date.now()) {
  emKlineCooldownUntil = now + EM_KLINE_COOLDOWN_MS;
}

/**
 * 用短硬超时探测一次 push2his。失败则进入冷却，供全市场历史快照统一改走腾讯。
 * 冷却期内立即返回 false，不会再发请求。
 */
export async function probeEastMoneyDailyKline(secid: string, limit = 20): Promise<boolean> {
  if (isEastMoneyKlineCooling()) return false;
  try {
    const bars = await withHardTimeout(
      fetchEastMoneyKline(secid, 101, limit),
      EM_KLINE_PROBE_MS,
      "eastmoney kline probe timeout",
    );
    if (bars.length === 0) throw new Error("东方财富日K未返回有效K线");
    emKlineCooldownUntil = 0;
    setCachedKline(secid, 101, limit, bars, "eastmoney");
    return true;
  } catch (err) {
    markEastMoneyKlineUnavailable();
    console.error("[eastmoney] kline probe failed, will use Tencent for this process window", err);
    return false;
  }
}

export async function fetchKlineWithSource(
  secid: string,
  klt: 101 | 102 | 103 = 101,
  limit = 400,
  opts?: FetchKlineOptions,
): Promise<{ bars: KlineBar[]; source: KlineFetchSource }> {
  const cached = getCachedKline(secid, klt, limit);
  if (cached) return { bars: cached.bars, source: cached.source };

  const allowEastMoney = opts?.allowEastMoney !== false && !isEastMoneyKlineCooling();

  const remember = (bars: KlineBar[], source: KlineFetchSource) => {
    setCachedKline(secid, klt, limit, bars, source);
    return { bars, source };
  };

  const tryEastMoney = async () => {
    const bars = await fetchEastMoneyKline(secid, klt, limit);
    emKlineCooldownUntil = 0;
    return remember(bars, "eastmoney");
  };
  const tryTencent = async () => {
    const bars = await fetchTencentKline(secid, klt, limit);
    return remember(bars, "tencent");
  };

  if (!allowEastMoney) {
    try {
      return await tryTencent();
    } catch (tencentErr) {
      throw tencentErr instanceof UpstreamUnavailableError
        ? tencentErr
        : new UpstreamUnavailableError(BOTH_KLINE_SOURCES_UNAVAILABLE, { cause: tencentErr });
    }
  }

  try {
    return await tryEastMoney();
  } catch (emErr) {
    markEastMoneyKlineUnavailable();
    console.error("[eastmoney] kline failed, trying Tencent fallback", emErr);
    try {
      return await tryTencent();
    } catch (tencentErr) {
      console.error("[eastmoney] Tencent kline fallback failed", tencentErr);
      throw new UpstreamUnavailableError(BOTH_KLINE_SOURCES_UNAVAILABLE, { cause: tencentErr });
    }
  }
}

export function resetKlineFallbackState() {
  emKlineCooldownUntil = 0;
}

export class EastMoneyProvider implements MarketDataProvider {
  id = "eastmoney";
  label = "东方财富公开行情";

  async fetchUniverse(onProgress?: (done: number, total: number) => void): Promise<{ total: number; quotes: QuoteRaw[] }> {
    const pageSize = 100;
    const first = await fetchWithHosts(
      `/api/qt/clist/get?pn=1&pz=${pageSize}&po=1&np=1&ut=${UT}&fltt=2&invt=2&fid=f6&fs=${encodeURIComponent(
        ETF_FS,
      )}&fields=${LIST_FIELDS}`,
      PUSH_HOSTS,
      8000,
    );
    const total = Number(first?.data?.total ?? 0);
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const quotes: QuoteRaw[] = [];
    const consume = (payload: any) => {
      const diff = (payload?.data?.diff ?? []) as Record<string, unknown>[];
      for (const row of diff) {
        const q = mapQuote(row);
        if (!q) continue;
        if (!looksLikeEtf(q.name)) continue;
        quotes.push(q);
      }
    };
    consume(first);
    onProgress?.(1, pages);
    for (let pn = 2; pn <= pages; pn++) {
      const payload = await fetchWithHosts(
        `/api/qt/clist/get?pn=${pn}&pz=${pageSize}&po=1&np=1&ut=${UT}&fltt=2&invt=2&fid=f6&fs=${encodeURIComponent(
          ETF_FS,
        )}&fields=${LIST_FIELDS}`,
        PUSH_HOSTS,
        8000,
      );
      consume(payload);
      onProgress?.(pn, pages);
      await sleep(40);
    }
    const uniq = new Map<string, QuoteRaw>();
    for (const q of quotes) uniq.set(q.code, q);
    return { total, quotes: [...uniq.values()] };
  }

  async fetchIopv(secid: string): Promise<IopvSnapshot> {
    const payload = await fetchWithHosts(
      `/api/qt/stock/get?secid=${encodeURIComponent(secid)}&invt=2&fltt=2&fields=f43,f57,f58,f71,f86,f130,f131`,
      PUSH_HOSTS,
    );
    const d = payload?.data ?? {};
    const code = String(secid.split(".")[1] ?? "");
    return {
      code,
      last: toNum(d.f43),
      iopv: toNum(d.f71),
      nav: toNum(d.f131),
      quoteTime: toNum(d.f86),
      updatedAt: Date.now(),
    };
  }

  async fetchFundProfile(code: string): Promise<FundProfile | null> {
    const rows = await this.fetchFundProfiles([code]);
    return rows[0] ?? null;
  }

  async fetchFundProfiles(codes: string[]): Promise<FundProfile[]> {
    if (codes.length === 0) return [];
    const batchSize = 40;
    const batches: string[][] = [];
    for (let i = 0; i < codes.length; i += batchSize) {
      batches.push(codes.slice(i, i + batchSize));
    }

    const fetchBatch = async (batch: string[]): Promise<FundProfile[]> => {
      const inner = batch.map((c) => `"${c}"`).join(",");
      const filter = `(SECURITY_CODE in (${inner}))`;
      const params = new URLSearchParams({
        reportName: "RPT_F10_FUND_INFO",
        columns: F10_COLUMNS,
        filter,
        pageNumber: "1",
        pageSize: String(batch.length),
        source: "WEB",
        client: "WEB",
      });
      let lastErr: unknown;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const payload = (await fetchJson(`${F10_URL}?${params.toString()}`)) as any;
          const rows = (payload?.result?.data ?? []) as Record<string, unknown>[];
          return rows.map(mapProfile);
        } catch (err) {
          lastErr = err;
          await sleep(250 * (attempt + 1));
        }
      }
      throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
    };

    const out: FundProfile[] = [];
    const concurrency = 4;
    for (let i = 0; i < batches.length; i += concurrency) {
      const slice = batches.slice(i, i + concurrency);
      const results = await Promise.allSettled(slice.map(fetchBatch));
      for (const res of results) {
        if (res.status === "fulfilled") out.push(...res.value);
      }
    }
    return out;
  }

  async fetchKline(secid: string, klt: 101 | 102 | 103, limit = 400): Promise<KlineBar[]> {
    const { bars } = await fetchKlineWithSource(secid, klt, limit);
    return bars;
  }

  async fetchTrends(secid: string): Promise<{ preClose: number | null; points: TrendPoint[] }> {
    const payload = await fetchWithHosts(
      `/api/qt/stock/trends2/get?secid=${encodeURIComponent(secid)}&fields1=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13&fields2=f51,f52,f53,f54,f55,f56,f57,f58&iscr=0&ndays=1`,
      PUSH_HOSTS,
    );
    const lines: string[] = payload?.data?.trends ?? [];
    const points = lines
      .map((line) => {
        const p = line.split(",");
        return {
          time: p[0],
          open: Number(p[1]),
          close: Number(p[2]),
          high: Number(p[3]),
          low: Number(p[4]),
          volume: Number(p[5]),
          amount: Number(p[6]),
          avgPrice: toNum(p[7]),
        } satisfies TrendPoint;
      })
      .filter((b) => Number.isFinite(b.close));
    return { preClose: toNum(payload?.data?.preClose), points };
  }

  async fetchOfficialNav(
    code: string,
    asOfDate: string,
    opts?: { timeoutMs?: number; attempts?: number },
  ): Promise<OfficialNav | null> {
    if (!/^\d{6}$/.test(code) || !/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) return null;
    const url = `https://api.fund.eastmoney.com/f10/lsjz?fundCode=${encodeURIComponent(code)}&pageIndex=1&pageSize=5&startDate=${encodeURIComponent(asOfDate)}&endDate=${encodeURIComponent(asOfDate)}`;
    const timeoutMs = opts?.timeoutMs ?? 20000;
    const attempts = Math.max(1, opts?.attempts ?? 3);
    let lastErr: unknown;
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const payload = await withHardTimeout(
          fetchJson(url, timeoutMs, { Referer: "https://fund.eastmoney.com/" }),
          timeoutMs + 500,
          "official nav timeout",
        );
        return parseOfficialNavLsjz(payload, code, asOfDate);
      } catch (err) {
        lastErr = err;
        await sleep(200 * (attempt + 1));
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  async fetchLatestOfficialNav(code: string): Promise<OfficialNav | null> {
    if (!/^\d{6}$/.test(code)) return null;
    const url = `https://api.fund.eastmoney.com/f10/lsjz?fundCode=${encodeURIComponent(code)}&pageIndex=1&pageSize=5`;
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const payload = (await fetchJson(url, 20000, { Referer: "https://fund.eastmoney.com/" })) as any;
        const list = (payload?.Data?.LSJZList ?? []) as Record<string, unknown>[];
        const rows = list
          .map((item) => ({
            date: String(item.FSRQ ?? "").slice(0, 10),
            nav: toNum(item.DWJZ),
          }))
          .filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item.date) && item.nav !== null && item.nav !== 0)
          .sort((a, b) => b.date.localeCompare(a.date));
        if (!rows[0]) return null;
        return { code, date: rows[0].date, nav: rows[0].nav as number };
      } catch (err) {
        lastErr = err;
        await sleep(200 * (attempt + 1));
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }
}

export const eastMoneyProvider = new EastMoneyProvider();
