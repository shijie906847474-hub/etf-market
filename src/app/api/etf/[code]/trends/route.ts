import { NextResponse } from "next/server";
import { computeIntradayVwap } from "@/lib/indicators";
import { getTrends } from "@/lib/server/market-service";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  ctx: { params: Promise<{ code: string }> },
) {
  try {
    const { code } = await ctx.params;
    const url = new URL(request.url);
    const m = url.searchParams.get("market");
    const market = m === "0" || m === "1" ? Number(m) : undefined;
    const data = await getTrends(code, market);
    return NextResponse.json({
      ...data,
      vwap: computeIntradayVwap(data.points),
      source: "东方财富公开行情",
      note: "分时 VWAP 由累计成交额/累计份额计算；1 手按 100 份换算。",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "分时接口异常";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
