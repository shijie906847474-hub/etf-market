import { NextResponse } from "next/server";
import { getEtfDetail } from "@/lib/server/market-service";

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
    if (!/^\d{6}$/.test(code)) {
      return NextResponse.json({ error: "无效的 ETF 代码" }, { status: 400 });
    }
    const data = await getEtfDetail(code, market);
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "详情接口异常";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
