import { NextResponse } from "next/server";
import { getMarketPayload } from "@/lib/server/market-service";
import { getPrevClosePayload } from "@/lib/server/prev-close";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  try {
    const view = new URL(req.url).searchParams.get("view");
    const data = view === "prev" ? await getPrevClosePayload() : await getMarketPayload();
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
