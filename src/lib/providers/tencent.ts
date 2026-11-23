import { toNum } from "../format";
import { isAbortLike, TENCENT_QUOTES_UNAVAILABLE, UpstreamUnavailableError } from "./errors";
import type { QuoteRaw } from "./types";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const QUOTE_URL = "https://qt.gtimg.cn/q=";
const CHUNK_SIZE = 60;
const CONCURRENCY = 3;
const TIMEOUT_MS = 8000;

export type UniverseItem = { code: string; market: 0 | 1; name: string };

export type QuoteSource = "eastmoney" | "tencent";

export function tencentSymbol(code: string, market: 0 | 1): string {
  return `${market === 1 ? "sh" : "sz"}${code}`;
}

export function marketFromTencentSymbol(symbol: string): 0 | 1 | null {
  const prefix = symbol.slice(0, 2).toLowerCase();
  if (prefix === "sh") return 1;
  if (prefix === "sz") return 0;
  return null;
}

export function decodeTencentBytes(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return new TextDecoder("gb18030").decode(bytes);
}

/** 腾讯字段 30：YYYYMMDDHHmmss，按 Asia/Shanghai 转为 Unix 秒，与东方财富 clist f124 一致。 */
export function parseTencentQuoteTime(raw: string | null | undefined): number | null {
  const s = String(raw ?? "").trim();
  const m = s.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  if (!m) return null;
  const ms = Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+08:00`);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

/**
 * 成交额（元）。2026-11-23（Asia/Shanghai）对照东方财富 ulist：
 * 510300 / 513100 的字段 35 第三段与 f6 完全一致（元）；
 * 字段 57 为万元（带小数），×10000 后与 f6 一致；
 * 字段 37 为整万元，有四舍五入，仅作最后回退。
 */
export function parseTencentTurnoverYuan(fields: string[]): number | null {
  const compound = fields[35] ?? "";
  const parts = compound.split("/");
  if (parts.length >= 3) {
    const yuan = toNum(parts[2]);
    if (yuan != null) return yuan;
  }
  const wanPrecise = toNum(fields[57]);
  if (wanPrecise != null) return wanPrecise * 10000;
  const wan = toNum(fields[37]);
  if (wan != null) return wan * 10000;
  return null;
}

function emptyQuote(item: UniverseItem): QuoteRaw {
  return {
    code: item.code,
    market: item.market,
    name: item.name,
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
    listedDateRaw: null,
    quoteTime: null,
    ret5d: null,
    ret20d: null,
    ret60d: null,
    ret1y: null,
    ytdChangePct: null,
    statusHint: null,
  };
}

/**
 * 解析单行腾讯行情。已与东方财富 ulist 抽样核对（2026-11-23，Asia/Shanghai，
 * 510300 / 159915 / 513100 / 159941）的字段才映射：
 * 3 最新价、4 昨收、5 今开、6 成交量（手，与 f5 一致）、9 买一、19 卖一、
 * 30 行情时间、31 涨跌额、32 涨跌幅、33 最高、34 最低、
 * 35 第三段成交额（元，与 f6 一致）、38 换手率（与 f8 一致）、
 * 43 振幅（与 f7 一致）、49 量比（与 f10 一致）。
 * 不映射未核对的区间涨跌、停牌标记，也不把最新价/昨收当作官方净值。
 */
export function parseTencentLine(line: string, fallback?: UniverseItem): QuoteRaw | null {
  const m = line.trim().match(/^v_([a-z]{2}\d{6})\s*=\s*"(.*)"\s*;?\s*$/i);
  if (!m) return null;
  const symbol = m[1].toLowerCase();
  const fields = m[2].split("~");
  const code = (fields[2] || symbol.slice(2)).trim();
  if (!/^\d{6}$/.test(code)) return null;
  const market = marketFromTencentSymbol(symbol) ?? fallback?.market ?? (code.startsWith("5") ? 1 : 0);
  return {
    code,
    market,
    name: (fields[1] || fallback?.name || "").trim() || code,
    last: toNum(fields[3]),
    change: toNum(fields[31]),
    changePct: toNum(fields[32]),
    volume: toNum(fields[6]),
    turnover: parseTencentTurnoverYuan(fields),
    amplitude: toNum(fields[43]),
    turnoverRate: toNum(fields[38]),
    volumeRatio: toNum(fields[49]),
    high: toNum(fields[33]),
    low: toNum(fields[34]),
    open: toNum(fields[5]),
    prevClose: toNum(fields[4]),
    bid1: toNum(fields[9]),
    ask1: toNum(fields[19]),
    listedDateRaw: null,
    quoteTime: parseTencentQuoteTime(fields[30]),
    ret5d: null,
    ret20d: null,
    ret60d: null,
    ret1y: null,
    ytdChangePct: null,
    statusHint: null,
  };
}

export function parseTencentBody(text: string): QuoteRaw[] {
  const out: QuoteRaw[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const q = parseTencentLine(line);
    if (q) out.push(q);
  }
  return out;
}

export function mergeTencentQuotes(items: UniverseItem[], quotes: QuoteRaw[]): QuoteRaw[] {
  const byCode = new Map(quotes.map((q) => [q.code, q]));
  return items.map((item) => {
    const q = byCode.get(item.code);
    if (!q) return emptyQuote(item);
    return {
      ...q,
      market: item.market,
      name: q.name || item.name,
    };
  });
}

async function fetchTencentChunk(symbols: string[]): Promise<QuoteRaw[]> {
  const url = `${QUOTE_URL}${symbols.join(",")}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      cache: "no-store",
      headers: {
        "User-Agent": UA,
        Referer: "https://finance.qq.com/",
        Accept: "text/plain,*/*",
      },
    });
    if (!res.ok) {
      console.error(`[tencent] HTTP ${res.status} qt.gtimg.cn chunk size=${symbols.length}`);
      throw new UpstreamUnavailableError(TENCENT_QUOTES_UNAVAILABLE, { status: res.status, sourceHost: "qt.gtimg.cn" });
    }
    const text = decodeTencentBytes(await res.arrayBuffer());
    return parseTencentBody(text);
  } catch (err) {
    if (err instanceof UpstreamUnavailableError) throw err;
    if (isAbortLike(err)) {
      console.error(`[tencent] timeout/aborted qt.gtimg.cn chunk size=${symbols.length}`);
      throw new UpstreamUnavailableError(TENCENT_QUOTES_UNAVAILABLE, { cause: err, sourceHost: "qt.gtimg.cn" });
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchTencentQuotes(items: UniverseItem[]): Promise<QuoteRaw[]> {
  if (items.length === 0) return [];
  const chunks: UniverseItem[][] = [];
  for (let i = 0; i < items.length; i += CHUNK_SIZE) {
    chunks.push(items.slice(i, i + CHUNK_SIZE));
  }

  const collected: QuoteRaw[] = [];
  let lastErr: unknown;
  let ok = 0;
  for (let i = 0; i < chunks.length; i += CONCURRENCY) {
    const slice = chunks.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      slice.map((chunk) => fetchTencentChunk(chunk.map((item) => tencentSymbol(item.code, item.market)))),
    );
    for (const res of results) {
      if (res.status === "fulfilled") {
        collected.push(...res.value);
        ok += 1;
      } else {
        lastErr = res.reason;
        console.error("[tencent] chunk failed", res.reason);
      }
    }
  }
  if (ok === 0) {
    throw lastErr instanceof Error ? lastErr : new UpstreamUnavailableError(TENCENT_QUOTES_UNAVAILABLE, { cause: lastErr });
  }
  return mergeTencentQuotes(items, collected);
}
