/**
 * Offline check: parse saved Tencent newfqkline / fqkline samples.
 * Does not require network. Sample captures 2026-11-23 session close (Asia/Shanghai).
 */
import fs from "fs";
import path from "path";
import { isNetworkFetchError, publicUpstreamMessage } from "../src/lib/providers/errors";
import {
  parseTencentKlineAmountYuan,
  parseTencentKlineBars,
  tencentSymbolFromSecid,
} from "../src/lib/providers/tencent";

const fixture = path.join(__dirname, "fixtures", "tencent-kline-sample.json");

function assertEqual(label: string, actual: unknown, want: unknown) {
  if (actual !== want) {
    throw new Error(`${label}: expected ${JSON.stringify(want)}, got ${JSON.stringify(actual)}`);
  }
}

function assertClose(label: string, actual: number | null, want: number, digits = 4) {
  if (actual == null || !Number.isFinite(actual) || Number(actual.toFixed(digits)) !== Number(want.toFixed(digits))) {
    throw new Error(`${label}: expected ${want}, got ${actual}`);
  }
}

function main() {
  assertEqual("secid 1.510300", tencentSymbolFromSecid("1.510300"), "sh510300");
  assertEqual("secid 0.159915", tencentSymbolFromSecid("0.159915"), "sz159915");
  assertEqual("bad secid", tencentSymbolFromSecid("510300"), null);

  const sample = JSON.parse(fs.readFileSync(fixture, "utf8")) as Record<string, unknown>;

  const bars = parseTencentKlineBars(sample.newfqkline_sh510300, "sh510300", 101);
  assertEqual("newfqkline bar count", bars.length, 2);
  const last = bars[1];
  assertEqual("510300 date", last.time, "2026-11-23");
  assertEqual("510300 open", last.open, 3.997);
  assertEqual("510300 close", last.close, 4.023);
  assertEqual("510300 high", last.high, 4.045);
  assertEqual("510300 low", last.low, 3.976);
  assertEqual("510300 volume hands", last.volume, 13939903);
  assertEqual("510300 amount yuan", last.amount, 5589278200);
  assertEqual("510300 turnoverRate", last.turnoverRate, 2.51);
  assertClose("510300 change vs 11-20 close", last.change, 4.023 - 4.018);
  assertClose("510300 changePct", last.changePct, ((4.023 - 4.018) / 4.018) * 100);
  assertClose("510300 amplitude vs prev close", last.amplitude, ((4.045 - 3.976) / 4.018) * 100);
  assertEqual("amount helper", parseTencentKlineAmountYuan(["2026-11-23", "3.997", "4.023", "4.045", "3.976", "13939903.00", {}, "2.51", "558927.82", ""]), 5589278200);

  const six = parseTencentKlineBars(sample.web_fqkline_sh510300, "sh510300", 101);
  assertEqual("six-field count", six.length, 2);
  assertEqual("six-field close", six[1].close, 4.023);
  assertEqual("six-field volume", six[1].volume, 13939903);
  assertEqual("six-field amount missing is not 0", Number.isFinite(six[1].amount), false);
  assertEqual("six-field amount helper", parseTencentKlineAmountYuan(["2026-11-23", "3.997", "4.023", "4.045", "3.976", "13939903.000"]), null);

  const gem = parseTencentKlineBars(sample.newfqkline_sz159915, "sz159915", 101);
  assertEqual("159915 close", gem[0].close, 2.295);
  assertEqual("159915 amount yuan", gem[0].amount, 13750123000);

  const fetchFailed = new TypeError("fetch failed");
  (fetchFailed as Error & { cause?: { code: string } }).cause = { code: "UND_ERR_SOCKET" };
  assertEqual("fetch failed is network error", isNetworkFetchError(fetchFailed), true);
  const msg = publicUpstreamMessage(fetchFailed);
  if (!msg.includes("东方财富") || msg.includes("fetch failed")) {
    throw new Error(`publicUpstreamMessage should be Chinese without raw fetch failed, got ${msg}`);
  }

  console.log("parse-tencent-kline: ok");
}

main();
