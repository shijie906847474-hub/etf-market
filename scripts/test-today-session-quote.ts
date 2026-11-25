/**
 * Offline check: live 今日市场涨跌幅只采用当天 09:15 之后的行情时间。
 * Does not require network. Anchored to 2026-11-25 morning (Asia/Shanghai).
 */
import { isTodaySessionQuote, liveSessionChange } from "../src/lib/market-hours";
import { mergeRow } from "../src/lib/server/market-service";
import type { QuoteRaw } from "../src/lib/providers/types";

function assertEqual(label: string, actual: unknown, want: unknown) {
  if (actual !== want) {
    throw new Error(`${label}: expected ${JSON.stringify(want)}, got ${JSON.stringify(actual)}`);
  }
}

function ts(iso: string): number {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) throw new Error(`bad iso ${iso}`);
  return Math.floor(ms / 1000);
}

function quote(partial: Partial<QuoteRaw> = {}): QuoteRaw {
  return {
    code: "518880",
    market: 1,
    name: "黄金ETF华安",
    last: 7.391,
    change: -0.005,
    changePct: -0.07,
    volume: 5722771,
    turnover: 4253014632,
    amplitude: 1.85,
    turnoverRate: 4.96,
    volumeRatio: 0.89,
    high: 7.505,
    low: 7.368,
    open: 7.49,
    prevClose: 7.396,
    bid1: 7.39,
    ask1: 7.391,
    listedDateRaw: null,
    quoteTime: ts("2026-11-24T16:14:50+08:00"),
    ret5d: -6.41,
    ret20d: null,
    ret60d: null,
    ret1y: null,
    ytdChangePct: null,
    statusHint: null,
    ...partial,
  };
}

function main() {
  const morning = Date.parse("2026-11-25T08:38:00+08:00");
  const afterOpen = Date.parse("2026-11-25T09:35:00+08:00");
  const afterClose = Date.parse("2026-11-25T16:20:00+08:00");

  // Production 2026-11-25 08:38 case: 518880 tape is still 11-24 close-to-close (-0.07).
  const ydayClose = ts("2026-11-24T16:14:50+08:00");
  assertEqual("yesterday close is not today session", isTodaySessionQuote(ydayClose, morning), false);
  assertEqual("null quoteTime is not today", isTodaySessionQuote(null, morning), false);
  assertEqual("today 08:00 heartbeat is not session", isTodaySessionQuote(ts("2026-11-25T08:00:00+08:00"), morning), false);
  assertEqual("today 09:15 auction is session", isTodaySessionQuote(ts("2026-11-25T09:15:00+08:00"), afterOpen), true);
  assertEqual("today 09:30 is session", isTodaySessionQuote(ts("2026-11-25T09:30:01+08:00"), afterOpen), true);
  assertEqual("today 16:14 after close is still today session", isTodaySessionQuote(ts("2026-11-25T16:14:50+08:00"), afterClose), true);
  assertEqual("millisecond quoteTime accepted", isTodaySessionQuote(Date.parse("2026-11-25T09:30:00+08:00"), afterOpen), true);

  const stale = liveSessionChange(-0.005, -0.07, ydayClose, morning);
  assertEqual("stale change nulled", stale.change, null);
  assertEqual("stale changePct nulled", stale.changePct, null);

  const live = liveSessionChange(-0.005, -0.07, ts("2026-11-25T09:30:01+08:00"), afterOpen);
  assertEqual("live change kept", live.change, -0.005);
  assertEqual("live changePct kept", live.changePct, -0.07);

  const historyRow = mergeRow(quote());
  assertEqual("history path keeps yesterday changePct", historyRow.changePct, -0.07);
  assertEqual("history path keeps last", historyRow.last, 7.391);

  const liveStale = mergeRow(quote(), undefined, undefined, null, { liveSession: true, now: morning });
  assertEqual("live pre-open 商品 changePct is empty", liveStale.changePct, null);
  assertEqual("live pre-open 商品 change is empty", liveStale.change, null);
  assertEqual("live pre-open last still shown", liveStale.last, 7.391);
  assertEqual("live pre-open prevClose kept", liveStale.prevClose, 7.396);

  const liveToday = mergeRow(
    quote({ quoteTime: ts("2026-11-25T09:30:01+08:00"), last: 7.42, change: 0.024, changePct: 0.32 }),
    undefined,
    undefined,
    null,
    { liveSession: true, now: afterOpen },
  );
  assertEqual("live session keeps today changePct", liveToday.changePct, 0.32);

  // Equity ETF has the same overnight tape; guard is not 商品-only.
  const equity = mergeRow(
    quote({ code: "510300", name: "沪深300ETF华泰柏瑞", last: 4.033, change: 0.01, changePct: 0.25, prevClose: 4.023 }),
    undefined,
    undefined,
    null,
    { liveSession: true, now: morning },
  );
  assertEqual("live pre-open equity changePct also empty", equity.changePct, null);

  console.log("test-today-session-quote: ok");
}

main();
