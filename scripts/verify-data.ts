import { EastMoneyProvider } from "../src/lib/providers/eastmoney";
import { classifyEtf } from "../src/lib/classify";

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
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
