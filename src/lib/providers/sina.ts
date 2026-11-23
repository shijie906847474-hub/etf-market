import { looksLikeEtf } from "./eastmoney";
import { isAbortLike, UpstreamUnavailableError } from "./errors";
import type { UniverseItem } from "./tencent";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const NODE_DATA_URL = "https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData";
const NODE_COUNT_URL =
  "https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeStockCount?node=etf_hq_fund";
const NODE = "etf_hq_fund";
const PAGE_SIZE = 80;
const TIMEOUT_MS = 15000;

const SINA_UNAVAILABLE = "新浪基金 ETF 名单暂时不可用";

export function decodeSinaBytes(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  try {
    JSON.parse(utf8);
    return utf8;
  } catch {
    return new TextDecoder("gb18030").decode(bytes);
  }
}

export function parseSinaNodeCount(text: string): number | null {
  try {
    const n = Number(JSON.parse(text.trim()));
    return Number.isFinite(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
}

export function parseSinaNodeBody(text: string): UniverseItem[] {
  const data = JSON.parse(text) as unknown;
  if (!Array.isArray(data)) throw new Error("新浪基金 ETF 名单格式异常");
  const items: UniverseItem[] = [];
  for (const row of data) {
    if (!row || typeof row !== "object") continue;
    const rec = row as Record<string, unknown>;
    const symbol = String(rec.symbol ?? "").trim().toLowerCase();
    const codeFromSymbol = symbol.replace(/^[a-z]+/, "");
    const code = String(rec.code ?? codeFromSymbol).trim();
    if (!/^\d{6}$/.test(code)) continue;
    const name = String(rec.name ?? "").trim() || code;
    if (!looksLikeEtf(name)) continue;
    const market: 0 | 1 = symbol.startsWith("sh") ? 1 : symbol.startsWith("sz") ? 0 : code.startsWith("5") ? 1 : 0;
    items.push({ code, market, name });
  }
  return items;
}

async function fetchSinaText(url: string): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      cache: "no-store",
      headers: {
        "User-Agent": UA,
        Referer: "https://finance.sina.com.cn/",
        Accept: "application/json,text/plain,*/*",
      },
    });
    if (!res.ok) {
      console.error(`[sina] HTTP ${res.status} ${new URL(url).pathname}`);
      throw new UpstreamUnavailableError(SINA_UNAVAILABLE, { status: res.status, sourceHost: "vip.stock.finance.sina.com.cn" });
    }
    return decodeSinaBytes(await res.arrayBuffer());
  } catch (err) {
    if (err instanceof UpstreamUnavailableError) throw err;
    if (isAbortLike(err)) {
      console.error("[sina] timeout/aborted Market_Center.getHQNodeData");
      throw new UpstreamUnavailableError(SINA_UNAVAILABLE, { cause: err, sourceHost: "vip.stock.finance.sina.com.cn" });
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function nodeDataUrl(page: number): string {
  const params = new URLSearchParams({
    page: String(page),
    num: String(PAGE_SIZE),
    sort: "symbol",
    asc: "1",
    node: NODE,
    symbol: "",
    _s_r_a: page === 1 ? "init" : "page",
  });
  return `${NODE_DATA_URL}?${params.toString()}`;
}

/**
 * 新浪 Market_Center.getHQNodeData 节点 etf_hq_fund 名单。
 * 覆盖少于东方财富 typelist，仅在 typelist 失败时使用；行情仍走腾讯，不用新浪最新价。
 */
export async function fetchSinaEtfUniverse(
  onProgress?: (done: number, total: number) => void,
): Promise<{ total: number; items: UniverseItem[] }> {
  let count: number | null = null;
  try {
    count = parseSinaNodeCount(await fetchSinaText(NODE_COUNT_URL));
  } catch (err) {
    console.error("[sina] node count failed, will page until a short page", err);
  }

  const knownPages = count != null && count >= 0 ? Math.max(1, Math.ceil(count / PAGE_SIZE)) : null;
  const byCode = new Map<string, UniverseItem>();
  let rawCount = 0;
  let lastLen = 0;
  let lastErr: unknown;
  const maxPages = knownPages ?? 40;

  for (let page = 1; page <= maxPages; page++) {
    let rows: UniverseItem[] | null = null;
    let rawLen = 0;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const text = await fetchSinaText(nodeDataUrl(page));
        const parsed = JSON.parse(text) as unknown;
        rawLen = Array.isArray(parsed) ? parsed.length : 0;
        rows = parseSinaNodeBody(text);
        break;
      } catch (err) {
        lastErr = err;
        await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
      }
    }
    if (!rows) {
      throw lastErr instanceof Error ? lastErr : new UpstreamUnavailableError(SINA_UNAVAILABLE, { cause: lastErr });
    }
    rawCount += rawLen;
    lastLen = rawLen;
    for (const item of rows) byCode.set(item.code, item);
    const totalHint = knownPages ?? page;
    onProgress?.(page, totalHint);
    if (knownPages == null && rawLen < PAGE_SIZE) break;
  }

  if (count != null && rawCount < count && rawCount < count * 0.98) {
    throw new Error(`新浪基金 ETF 名单不完整（${rawCount}/${count}），不会把截断名单当作全市场`);
  }
  if (byCode.size === 0) {
    throw new Error(SINA_UNAVAILABLE);
  }
  if (knownPages == null && lastLen >= PAGE_SIZE) {
    console.error("[sina] stopped at page cap with a full last page; not treating as complete");
    throw new Error("新浪基金 ETF 名单未能完整分页");
  }
  const items = [...byCode.values()];
  return { total: count ?? items.length, items };
}
