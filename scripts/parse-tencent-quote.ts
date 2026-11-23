/**
 * Offline check: parse a saved Tencent qt.gtimg.cn sample and assert field mapping.
 * Does not require network. Sample captured 2026-11-23 10:44:54 (Asia/Shanghai).
 */
import fs from "fs";
import path from "path";
import {
  decodeTencentBytes,
  mergeTencentQuotes,
  parseTencentBody,
  parseTencentQuoteTime,
  parseTencentTurnoverYuan,
} from "../src/lib/providers/tencent";

const fixture = path.join(__dirname, "fixtures", "tencent-quotes-sample.txt");

const expected = {
  "510300": {
    market: 1 as const,
    name: "沪深300ETF华泰柏瑞",
    last: 3.985,
    prevClose: 4.018,
    open: 3.997,
    volume: 4023574,
    turnover: 1603278254,
    change: -0.033,
    changePct: -0.82,
    high: 3.997,
    low: 3.976,
    bid1: 3.984,
    ask1: 3.985,
    turnoverRate: 0.73,
    amplitude: 0.52,
    volumeRatio: 0.49,
    quoteTime: 1795401894,
  },
  "159915": {
    market: 0 as const,
    name: "创业板ETF易方达",
    last: 2.21,
    prevClose: 2.23,
    open: 2.203,
    volume: 23468961,
    turnover: 5215313843,
    change: -0.02,
    changePct: -0.9,
    high: 2.248,
    low: 2.202,
    bid1: 2.209,
    ask1: 2.21,
    turnoverRate: 4.41,
    amplitude: 2.06,
    volumeRatio: 1.4,
    quoteTime: 1795401891,
  },
  "513100": {
    market: 1 as const,
    name: "纳指ETF国泰",
    last: 2.0,
    prevClose: 2.074,
    open: 2.02,
    volume: 632345,
    turnover: 126758124,
    change: -0.074,
    changePct: -3.57,
    high: 2.035,
    low: 1.996,
    bid1: 1.999,
    ask1: 2.0,
    turnoverRate: 0.65,
    amplitude: 1.88,
    volumeRatio: 1.44,
    quoteTime: 1795401894,
  },
  "159941": {
    market: 0 as const,
    name: "纳指ETF广发",
    last: 1.469,
    prevClose: 1.526,
    open: 1.495,
    volume: 2131454,
    turnover: 314793077,
    change: -0.057,
    changePct: -3.74,
    high: 1.5,
    low: 1.467,
    bid1: 1.469,
    ask1: 1.47,
    turnoverRate: 0.93,
    amplitude: 2.16,
    volumeRatio: 1.2,
    quoteTime: 1795401891,
  },
} as const;

function assertEqual(label: string, actual: unknown, want: unknown) {
  if (actual !== want) {
    throw new Error(`${label}: expected ${JSON.stringify(want)}, got ${JSON.stringify(actual)}`);
  }
}

function almostEqual(a: number | null, b: number, eps = 1e-9) {
  return a != null && Math.abs(a - b) <= eps;
}

function main() {
  const text = fs.readFileSync(fixture, "utf8");
  const quotes = parseTencentBody(text);
  assertEqual("quote count", quotes.length, 4);

  assertEqual("quoteTime helper 510300", parseTencentQuoteTime("20261123104454"), 1795401894);
  assertEqual("quoteTime helper 159915", parseTencentQuoteTime("20261123104451"), 1795401891);

  const sh300 = text.split("\n").find((l) => l.includes("v_sh510300"));
  if (!sh300) throw new Error("missing 510300 line");
  const fields = (sh300.match(/="(.*)"/)?.[1] ?? "").split("~");
  assertEqual("turnover from field 35", parseTencentTurnoverYuan(fields), 1603278254);
  const without35 = fields.slice();
  without35[35] = "";
  assertEqual("turnover fallback field 57 * 10000", parseTencentTurnoverYuan(without35), 160327.8254 * 10000);

  for (const q of quotes) {
    const want = expected[q.code as keyof typeof expected];
    if (!want) throw new Error(`unexpected code ${q.code}`);
    assertEqual(`${q.code} market`, q.market, want.market);
    assertEqual(`${q.code} name`, q.name, want.name);
    for (const key of [
      "last",
      "prevClose",
      "open",
      "volume",
      "turnover",
      "change",
      "changePct",
      "high",
      "low",
      "bid1",
      "ask1",
      "turnoverRate",
      "amplitude",
      "volumeRatio",
      "quoteTime",
    ] as const) {
      const actual = q[key];
      const expect = want[key];
      if (typeof expect === "number" && !Number.isInteger(expect)) {
        if (!almostEqual(actual, expect)) {
          throw new Error(`${q.code} ${key}: expected ${expect}, got ${actual}`);
        }
      } else {
        assertEqual(`${q.code} ${key}`, actual, expect);
      }
    }
    assertEqual(`${q.code} ytdChangePct stays empty`, q.ytdChangePct, null);
    assertEqual(`${q.code} statusHint stays empty`, q.statusHint, null);
    assertEqual(`${q.code} ret5d stays empty`, q.ret5d, null);
  }

  const merged = mergeTencentQuotes(
    [
      { code: "510300", market: 1, name: "cached" },
      { code: "000000", market: 0, name: "仅有名单" },
    ],
    quotes,
  );
  assertEqual("merge keeps universe size", merged.length, 2);
  assertEqual("merge missing code is empty quote", merged[1]?.last, null);
  assertEqual("merge missing code keeps name", merged[1]?.name, "仅有名单");

  // decodeTencentBytes should accept UTF-8-incompatible GB18030 bytes via a synthetic GBK string
  const gbkName = new TextEncoder().encode("ok");
  const decoded = decodeTencentBytes(gbkName);
  if (!decoded.includes("ok")) throw new Error("decodeTencentBytes failed on ascii");

  console.log("parse-tencent-quote: ok", quotes.map((q) => q.code).join(","));
}

main();
