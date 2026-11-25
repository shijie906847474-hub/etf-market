/**
 * Offline checks for history close-snapshot load helpers:
 * hard timeouts, official NAV same-date parsing, kline cache, and
 * push2his cooldown that must not walk East Money hosts per ETF.
 */
import fs from "fs";
import path from "path";
import { mapPool, withHardTimeout } from "../src/lib/async-pool";
import {
  fetchKlineWithSource,
  parseOfficialNavLsjz,
  probeEastMoneyDailyKline,
  resetKlineFallbackState,
} from "../src/lib/providers/eastmoney";
import { klineCacheSize, resetKlineCache } from "../src/lib/providers/kline-cache";
import { fetchTencentKline, getTencentKlinePreferredBase, resetTencentKlineState } from "../src/lib/providers/tencent";

const fixture = path.join(__dirname, "fixtures", "tencent-kline-sample.json");

function assert(label: string, cond: unknown): asserts cond {
  if (!cond) throw new Error(label);
}

function assertEqual(label: string, actual: unknown, want: unknown) {
  if (actual !== want) {
    throw new Error(`${label}: expected ${JSON.stringify(want)}, got ${JSON.stringify(actual)}`);
  }
}

function jsonResponse(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}

function hangingFetch(signal?: AbortSignal | null): Promise<Response> {
  return new Promise((_, reject) => {
    const abort = () => reject(new DOMException("This operation was aborted", "AbortError"));
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function hostOf(input: RequestInfo | URL): string {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  try {
    return new URL(raw).host;
  } catch {
    return raw;
  }
}

async function testMapPoolAndTimeout() {
  const seen: number[] = [];
  let inflight = 0;
  let maxInflight = 0;
  const out = await mapPool([1, 2, 3, 4, 5], 2, async (n) => {
    inflight += 1;
    maxInflight = Math.max(maxInflight, inflight);
    await new Promise((r) => setTimeout(r, 20));
    inflight -= 1;
    seen.push(n);
    return n * 10;
  });
  assertEqual("mapPool result", out.join(","), "10,20,30,40,50");
  assertEqual("mapPool order-independent completeness", [...seen].sort((a, b) => a - b).join(","), "1,2,3,4,5");
  assert("mapPool respects concurrency", maxInflight <= 2);
  assert("mapPool used concurrency", maxInflight === 2);

  const t0 = Date.now();
  const value = await withHardTimeout(Promise.resolve(7), 200, "should not fire");
  assertEqual("hard timeout resolves", value, 7);
  assert("hard timeout fast path", Date.now() - t0 < 100);

  const hung = new Promise<number>(() => {});
  const t1 = Date.now();
  let rejected = false;
  try {
    await withHardTimeout(hung, 50, "history-timeout");
  } catch (err) {
    rejected = err instanceof Error && err.message === "history-timeout";
  }
  const elapsed = Date.now() - t1;
  assert("hard timeout rejects hung promise", rejected);
  assert(`hard timeout ~50ms (got ${elapsed})`, elapsed >= 40 && elapsed < 400);
}

function testOfficialNavParser() {
  const payload = {
    Data: {
      LSJZList: [
        { FSRQ: "2026-11-21", DWJZ: "4.0100" },
        { FSRQ: "2026-11-24", DWJZ: "4.0383" },
      ],
    },
  };
  const hit = parseOfficialNavLsjz(payload, "510300", "2026-11-24");
  assertEqual("same-date nav", hit?.nav, 4.0383);
  assertEqual("same-date date", hit?.date, "2026-11-24");
  assertEqual("earlier date is not reused", parseOfficialNavLsjz(payload, "510300", "2026-11-23"), null);
  assertEqual("zero nav rejected", parseOfficialNavLsjz({ Data: { LSJZList: [{ FSRQ: "2026-11-24", DWJZ: "0" }] } }, "510300", "2026-11-24"), null);
  assertEqual("empty list", parseOfficialNavLsjz({ Data: { LSJZList: [] } }, "510300", "2026-11-24"), null);
}

async function testKlineCooldownAndCache() {
  const sample = JSON.parse(fs.readFileSync(fixture, "utf8")) as Record<string, unknown>;
  const tencentPayload = sample.newfqkline_sh510300;
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const host = hostOf(input);
    calls.push(host);
    if (host.includes("eastmoney.com") || host.includes("push2")) {
      // 模拟 TLS 挂起且不响应 abort，这正是线上把槽位占满的情况。
      return new Promise<Response>(() => {});
    }
    if (host.includes("qq.com") || host.includes("gtimg.cn")) {
      return jsonResponse(tencentPayload);
    }
    throw new Error(`unexpected host ${host}`);
  }) as typeof fetch;

  try {
    resetKlineFallbackState();
    resetKlineCache();
    resetTencentKlineState();

    const t0 = Date.now();
    const available = await probeEastMoneyDailyKline("1.510300", 20);
    const probeMs = Date.now() - t0;
    assertEqual("probe fails closed", available, false);
    assert(`probe hard-timeout < 6s (got ${probeMs})`, probeMs < 6000);
    const emCallsAfterProbe = calls.filter((h) => h.includes("eastmoney") || h.includes("push2")).length;
    assert("probe issued at least one East Money request", emCallsAfterProbe >= 1);

    calls.length = 0;
    const first = await fetchKlineWithSource("1.510300", 101, 2);
    assertEqual("fallback source is tencent", first.source, "tencent");
    assert("returned kline bars", first.bars.length >= 1);
    const emDuringFetch = calls.filter((h) => h.includes("eastmoney") || h.includes("push2")).length;
    const tencentDuringFetch = calls.filter((h) => h.includes("qq.com") || h.includes("gtimg.cn")).length;
    assertEqual("cooldown skips push2his per symbol", emDuringFetch, 0);
    assert("used Tencent after cooldown", tencentDuringFetch >= 1);

    const callsAfterFirst = calls.length;
    const second = await fetchKlineWithSource("1.510300", 101, 2);
    assertEqual("cache source", second.source, "tencent");
    assertEqual("cache hit does not refetch", calls.length, callsAfterFirst);
    assert("cache populated", klineCacheSize() >= 1);

    // 即使腾讯失败，冷却期内也不得回打 push2his。
    const tencentFailCalls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const host = hostOf(input);
      tencentFailCalls.push(host);
      if (host.includes("eastmoney") || host.includes("push2")) {
        return hangingFetch(init?.signal);
      }
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    resetKlineCache();
    let failedFast = false;
    const t1 = Date.now();
    try {
      await fetchKlineWithSource("1.510300", 101, 2);
    } catch {
      failedFast = true;
    }
    const failMs = Date.now() - t1;
    assert("tencent failure still throws", failedFast);
    assertEqual(
      "tencent failure does not walk push2his",
      tencentFailCalls.filter((h) => h.includes("eastmoney") || h.includes("push2")).length,
      0,
    );
    assert(`tencent failure without EM hang is fast (got ${failMs})`, failMs < 6000);
  } finally {
    globalThis.fetch = originalFetch;
    resetKlineFallbackState();
    resetKlineCache();
    resetTencentKlineState();
  }
}

async function testTencentHostRace() {
  const sample = JSON.parse(fs.readFileSync(fixture, "utf8")) as Record<string, unknown>;
  const originalFetch = globalThis.fetch;
  let proxyHits = 0;
  let ifzqHits = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const host = hostOf(input);
    if (host === "proxy.finance.qq.com") {
      proxyHits += 1;
      return hangingFetch(init?.signal);
    }
    if (host === "web.ifzq.gtimg.cn") {
      ifzqHits += 1;
      return jsonResponse(sample.newfqkline_sh510300);
    }
    throw new Error(`unexpected host ${host}`);
  }) as typeof fetch;
  try {
    resetTencentKlineState();
    const t0 = Date.now();
    const bars = await fetchTencentKline("1.510300", 101, 2);
    const ms = Date.now() - t0;
    assert("race returned bars", bars.length >= 1);
    assert("hung proxy did not block race", ifzqHits >= 1);
    assert(`race finished quickly (got ${ms}ms)`, ms < 2000);
    assertEqual("sticky host is the winner", getTencentKlinePreferredBase(), "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get");

    const proxyBefore = proxyHits;
    const ifzqBefore = ifzqHits;
    await fetchTencentKline("1.510300", 101, 2);
    assertEqual("sticky host skips hung proxy", proxyHits, proxyBefore);
    assertEqual("sticky host reused ifzq", ifzqHits, ifzqBefore + 1);
  } finally {
    globalThis.fetch = originalFetch;
    resetTencentKlineState();
  }
}

async function main() {
  await testMapPoolAndTimeout();
  testOfficialNavParser();
  await testKlineCooldownAndCache();
  await testTencentHostRace();
  console.log("test-history-kline-load: ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
