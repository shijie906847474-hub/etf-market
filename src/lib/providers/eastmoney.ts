import { extractTrackingErrorTarget } from "../classify";
import { parseFeePercent, toNum } from "../format";
import type { FundProfile, IopvSnapshot, KlineBar, TrendPoint } from "../types";
import type { MarketDataProvider, QuoteRaw } from "./types";

const PUSH_HOSTS = [
  "https://82.push2.eastmoney.com",
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

async function fetchJson(url: string, timeoutMs = 20000): Promise<unknown> {
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
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWithHosts(pathAndQuery: string, hosts: string[]): Promise<any> {
  let lastErr: unknown;
  for (const host of hosts) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await fetchJson(`${host}${pathAndQuery}`);
      } catch (err) {
        lastErr = err;
        await sleep(180 * (attempt + 1));
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

function looksLikeEtf(name: string): boolean {
  if (/LOF|FOF|REITs|REIT/i.test(name) && !/ETF/i.test(name)) return false;
  return true;
}

export class EastMoneyProvider implements MarketDataProvider {
  id = "eastmoney";
  label = "东方财富公开行情";

  async fetchUniverse(): Promise<{ total: number; quotes: QuoteRaw[] }> {
    const pageSize = 100;
    const first = await fetchWithHosts(
      `/api/qt/clist/get?pn=1&pz=${pageSize}&po=1&np=1&ut=${UT}&fltt=2&invt=2&fid=f6&fs=${encodeURIComponent(
        ETF_FS,
      )}&fields=${LIST_FIELDS}`,
      PUSH_HOSTS,
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
    for (let pn = 2; pn <= pages; pn++) {
      const payload = await fetchWithHosts(
        `/api/qt/clist/get?pn=${pn}&pz=${pageSize}&po=1&np=1&ut=${UT}&fltt=2&invt=2&fid=f6&fs=${encodeURIComponent(
          ETF_FS,
        )}&fields=${LIST_FIELDS}`,
        PUSH_HOSTS,
      );
      consume(payload);
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
    const payload = await fetchWithHosts(
      `/api/qt/stock/kline/get?secid=${encodeURIComponent(secid)}&klt=${klt}&fqt=1&lmt=${limit}&end=20500101&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61`,
      HIS_HOSTS,
    );
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
}

export const eastMoneyProvider = new EastMoneyProvider();
