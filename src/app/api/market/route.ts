import { NextResponse } from "next/server";
import { getMarketPayload } from "@/lib/server/market-service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const data = await getMarketPayload();
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "行情接口异常";
    return NextResponse.json(
      {
        error: message,
        source: "东方财富公开行情",
        freshness: "接口异常",
      },
      { status: 502 },
    );
  }
}
