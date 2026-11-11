import { EastMoneyProvider } from "../src/lib/providers/eastmoney";
import { classifyEtf } from "../src/lib/classify";
import { ytdChangePctFromBars } from "../src/lib/returns";
import { shanghaiDateString } from "../src/lib/market-hours";

async function main() {
  const p = new EastMoneyProvider();
  const uni = await p.fetchUniverse();
  console.log("UNIVERSE_TOTAL_FIELD", uni.total);
  console.log("UNIVERSE_FETCHED", uni.quotes.length);
  const sample = uni.quotes.find((q) => q.code === "159915") ?? uni.quotes[0];
  console.log("SAMPLE_QUOTE", {
    code: sample.code,
    name: sample.name,
    last: sample.last,
    changePct: sample.changePct,
    turnover: sample.turnover,
    quoteTime: sample.quoteTime,
    ytdChangePct: sample.ytdChangePct,
    ret1y: sample.ret1y,
  });
  const iopv = await p.fetchIopv(`${sample.market}.${sample.code}`);
  console.log("SAMPLE_IOPV", iopv);
  if (iopv.iopv && sample.last) {
    console.log("SAMPLE_PREMIUM_PCT", ((sample.last - iopv.iopv) / iopv.iopv) * 100);
  }
  const f10 = await p.fetchFundProfile(sample.code);
  console.log("SAMPLE_F10", {
    code: f10?.code,
    fundType: f10?.fundType,
    level2: f10?.level2Class,
    indexName: f10?.indexName,
    aum: f10?.aum,
    aumDate: f10?.aumDate,
    fee: f10?.managementFee,
    category: classifyEtf(f10 ?? null),
  });
  const k = await p.fetchKline(`${sample.market}.${sample.code}`, 101, 5);
  console.log("SAMPLE_KLINE_LAST", k[k.length - 1]);

  const today = shanghaiDateString();
  const checks = [
    { secid: "1.510300", code: "510300" },
    { secid: "0.159915", code: "159915" },
    { secid: "1.513100", code: "513100" },
    { secid: "1.513290", code: "513290" },
  ];
  for (const item of checks) {
    const q = uni.quotes.find((x) => x.code === item.code);
    const bars = await p.fetchKline(item.secid, 101, 280);
    const last = bars.filter((b) => b.time <= today).pop();
    const prev = bars.filter((b) => b.time < today).pop();
    const ytdLive = last ? ytdChangePctFromBars(bars, last.time) : null;
    const ytdPrev = prev ? ytdChangePctFromBars(bars, prev.time) : null;
    console.log("YTD_CHECK", {
      code: item.code,
      name: q?.name ?? null,
      f25: q?.ytdChangePct ?? null,
      klineYtdAsOfLastBar: ytdLive,
      klineYtdAsOfPrevSession: ytdPrev,
      lastBar: last ? { time: last.time, close: last.close } : null,
      prevBar: prev ? { time: prev.time, close: prev.close } : null,
      matchF25:
        q?.ytdChangePct != null && ytdLive != null ? Math.abs(q.ytdChangePct - ytdLive) < 0.08 : null,
    });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
