import type { DataFreshness } from "./types";

const SHANGHAI = "Asia/Shanghai";

function parts(ts = Date.now()) {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: SHANGHAI,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const map: Record<string, string> = {};
  for (const p of fmt.formatToParts(new Date(ts))) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  const hhmm = Number((map.hour ?? "00") + (map.minute ?? "00"));
  return { weekday: map.weekday ?? "", hhmm };
}

export function marketFreshness(now = Date.now()): { freshness: DataFreshness; delayed: boolean } {
  const { weekday, hhmm } = parts(now);
  const weekend = weekday === "Sat" || weekday === "Sun";
  if (weekend) return { freshness: "非交易时段", delayed: true };
  const inSession =
    (hhmm >= 915 && hhmm <= 1130) || (hhmm >= 1300 && hhmm <= 1505);
  if (inSession) return { freshness: "交易时段（公开行情，可能延迟）", delayed: true };
  if (hhmm > 1505) return { freshness: "已收盘（日终行情）", delayed: false };
  return { freshness: "非交易时段", delayed: true };
}

export function shanghaiDateString(ts = Date.now()): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: SHANGHAI,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date(ts));
}

function quoteTimeMs(quoteTime: number): number {
  // East Money f124 / 腾讯字段 30 解析结果是 Unix 秒；容错毫秒时间戳。
  return quoteTime > 1e12 ? quoteTime : quoteTime * 1000;
}

/**
 * 今日市场的涨跌幅只采用上海日历「今天」、且行情时间已进入 09:15（竞价开始）及之后的报价。
 * 开盘前上游仍会挂着上一交易日的收盘价与收盘涨跌（商品/黄金 ETF 尤其容易被当成「今日」），这时返回 false。
 */
export function isTodaySessionQuote(quoteTime: number | null | undefined, now = Date.now()): boolean {
  if (quoteTime == null || !Number.isFinite(quoteTime)) return false;
  const ms = quoteTimeMs(quoteTime);
  if (!Number.isFinite(ms) || ms <= 0) return false;
  if (shanghaiDateString(ms) !== shanghaiDateString(now)) return false;
  return parts(ms).hhmm >= 915;
}

/** 非当日会话行情时，今日市场的涨跌额/涨跌幅留空，不把昨日收盘涨跌或隔夜现货波动当作今日涨跌。 */
export function liveSessionChange(
  change: number | null,
  changePct: number | null,
  quoteTime: number | null | undefined,
  now = Date.now(),
): { change: number | null; changePct: number | null } {
  if (isTodaySessionQuote(quoteTime, now)) return { change, changePct };
  return { change: null, changePct: null };
}

export function shanghaiSessionCloseUnix(dateStr: string): number {
  return Math.floor(new Date(`${dateStr}T15:00:00+08:00`).getTime() / 1000);
}
