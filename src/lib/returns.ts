import type { KlineBar } from "./types";

export interface CloseBar {
  time: string;
  close: number;
}

function lastOnOrBefore(bars: CloseBar[], date: string): CloseBar | null {
  for (let i = bars.length - 1; i >= 0; i--) {
    if (bars[i].time <= date && Number.isFinite(bars[i].close) && bars[i].close !== 0) {
      return bars[i];
    }
  }
  return null;
}

export function findBarOnDate<T extends { time: string }>(bars: T[], date: string): T | null {
  for (let i = bars.length - 1; i >= 0; i--) {
    if (bars[i].time === date) return bars[i];
  }
  return null;
}

/**
 * Year-to-date percent as of sessionDate:
 * (session_close / last_close_of_previous_calendar_year) - 1, times 100.
 * If the fund has no prior-year bar (listed this year), use the earliest
 * available close on or before sessionDate. Missing session or base => null.
 */
export function ytdChangePctFromBars(bars: CloseBar[], sessionDate: string): number | null {
  const session = lastOnOrBefore(bars.filter((b) => b.time === sessionDate || b.time <= sessionDate), sessionDate);
  const onDate = findBarOnDate(bars, sessionDate);
  const asof = onDate && Number.isFinite(onDate.close) && onDate.close !== 0 ? onDate : session;
  if (!asof) return null;
  const year = Number(sessionDate.slice(0, 4));
  if (!Number.isFinite(year)) return null;
  const prevYearEnd = `${year - 1}-12-31`;
  const priorYear = lastOnOrBefore(bars, prevYearEnd);
  const eligible = bars.filter((b) => b.time <= sessionDate && Number.isFinite(b.close) && b.close !== 0);
  const earliest = eligible[0] ?? null;
  const base = priorYear ?? earliest;
  if (!base || !base.close) return null;
  return Number((((asof.close / base.close) - 1) * 100).toFixed(4));
}

export function periodReturnFromBars(bars: KlineBar[], sessionDate: string, lookbackSessions: number): number | null {
  const idx = bars.findIndex((b) => b.time === sessionDate);
  if (idx < 0) return null;
  const baseIdx = idx - lookbackSessions;
  if (baseIdx < 0) return null;
  const asof = bars[idx]?.close;
  const base = bars[baseIdx]?.close;
  if (!Number.isFinite(asof) || !Number.isFinite(base) || !base) return null;
  return Number((((asof / base) - 1) * 100).toFixed(4));
}

export function yearReturnFromBars(bars: CloseBar[], sessionDate: string): number | null {
  const asof = findBarOnDate(bars, sessionDate);
  if (!asof || !asof.close) return null;
  const year = Number(sessionDate.slice(0, 4));
  const month = sessionDate.slice(5);
  if (!Number.isFinite(year)) return null;
  const prior = lastOnOrBefore(bars, `${year - 1}-${month}`);
  if (!prior || !prior.close) return null;
  return Number((((asof.close / prior.close) - 1) * 100).toFixed(4));
}
