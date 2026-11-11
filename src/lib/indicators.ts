import type { KlineBar, TrendPoint } from "./types";

export interface LinePoint {
  time: string;
  value: number;
}

export function sma(values: number[], period: number): Array<number | null> {
  const out: Array<number | null> = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    out.push(i >= period - 1 ? sum / period : null);
  }
  return out;
}

function ema(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const out: number[] = [];
  let prev = values[0] ?? 0;
  for (let i = 0; i < values.length; i++) {
    const v = i === 0 ? values[i] : values[i] * k + prev * (1 - k);
    out.push(v);
    prev = v;
  }
  return out;
}

export function macd(closes: number[], fast = 12, slow = 26, signal = 9) {
  const emaFast = ema(closes, fast);
  const emaSlow = ema(closes, slow);
  const dif = emaFast.map((v, i) => v - emaSlow[i]);
  const dea = ema(dif, signal);
  const hist = dif.map((v, i) => (v - dea[i]) * 2);
  return { dif, dea, hist };
}

export function rsi(closes: number[], period = 14): Array<number | null> {
  const out: Array<number | null> = [null];
  let gain = 0;
  let loss = 0;
  for (let i = 1; i < closes.length; i++) {
    const ch = closes[i] - closes[i - 1];
    const g = Math.max(ch, 0);
    const l = Math.max(-ch, 0);
    if (i <= period) {
      gain += g;
      loss += l;
      if (i < period) {
        out.push(null);
      } else {
        const ag = gain / period;
        const al = loss / period;
        out.push(al === 0 ? 100 : 100 - 100 / (1 + ag / al));
      }
    } else {
      gain = (gain * (period - 1) + g) / period;
      loss = (loss * (period - 1) + l) / period;
      out.push(loss === 0 ? 100 : 100 - 100 / (1 + gain / loss));
    }
  }
  return out;
}

export function boll(closes: number[], period = 20, mult = 2) {
  const mid = sma(closes, period);
  const upper: Array<number | null> = [];
  const lower: Array<number | null> = [];
  for (let i = 0; i < closes.length; i++) {
    if (mid[i] === null || i < period - 1) {
      upper.push(null);
      lower.push(null);
      continue;
    }
    let ss = 0;
    for (let j = 0; j < period; j++) {
      const d = closes[i - j] - (mid[i] as number);
      ss += d * d;
    }
    const sd = Math.sqrt(ss / period);
    upper.push((mid[i] as number) + mult * sd);
    lower.push((mid[i] as number) - mult * sd);
  }
  return { mid, upper, lower };
}

/** VWAP = 累计成交额 / 累计份额。东方财富成交量为手，1 手 = 100 份。 */
export function vwapFromBars(
  bars: Array<{ amount: number; volume: number; time: string }>,
): LinePoint[] {
  let amt = 0;
  let shares = 0;
  const out: LinePoint[] = [];
  for (const b of bars) {
    if (!Number.isFinite(b.amount) || !Number.isFinite(b.volume) || b.volume <= 0) continue;
    amt += b.amount;
    shares += b.volume * 100;
    if (shares > 0) out.push({ time: b.time, value: amt / shares });
  }
  return out;
}

export function computeKlineIndicators(bars: KlineBar[]) {
  const closes = bars.map((b) => b.close);
  const ma5 = sma(closes, 5);
  const ma10 = sma(closes, 10);
  const ma20 = sma(closes, 20);
  const ma60 = sma(closes, 60);
  const macdAll = macd(closes);
  const rsi14 = rsi(closes, 14);
  const b = boll(closes, 20, 2);
  return {
    ma5: toPoints(bars, ma5),
    ma10: toPoints(bars, ma10),
    ma20: toPoints(bars, ma20),
    ma60: toPoints(bars, ma60),
    macd: bars.map((bar, i) => ({
      time: bar.time,
      dif: macdAll.dif[i] ?? null,
      dea: macdAll.dea[i] ?? null,
      hist: macdAll.hist[i] ?? null,
    })),
    rsi: toPoints(bars, rsi14),
    boll: {
      mid: toPoints(bars, b.mid),
      upper: toPoints(bars, b.upper),
      lower: toPoints(bars, b.lower),
    },
    vwap: vwapFromBars(bars),
  };
}

function toPoints(bars: KlineBar[], values: Array<number | null>): LinePoint[] {
  const out: LinePoint[] = [];
  for (let i = 0; i < bars.length; i++) {
    const v = values[i];
    if (v !== null && Number.isFinite(v)) out.push({ time: bars[i].time, value: v });
  }
  return out;
}

export function computeIntradayVwap(points: TrendPoint[]): LinePoint[] {
  return vwapFromBars(points);
}
