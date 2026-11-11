import { NextResponse } from "next/server";
import { computeKlineIndicators } from "@/lib/indicators";
import { getKline } from "@/lib/server/market-service";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  ctx: { params: Promise<{ code: string }> },
) {
  try {
    const { code } = await ctx.params;
    const url = new URL(request.url);
    const period = url.searchParams.get("period") ?? "101";
    const klt = Number(period) as 101 | 102 | 103;
    if (![101, 102, 103].includes(klt)) {
      return NextResponse.json({ error: "period 仅支持 101/102/103" }, { status: 400 });
    }
    const m = url.searchParams.get("market");
    const market = m === "0" || m === "1" ? Number(m) : undefined;
    const bars = await getKline(code, klt, market);
    return NextResponse.json({
      bars,
      indicators: computeKlineIndicators(bars),
      source: "东方财富公开行情",
      note: "MA/MACD/RSI/BOLL/VWAP 均由 K 线现场计算，非行情源直接提供。",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "K线接口异常";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
