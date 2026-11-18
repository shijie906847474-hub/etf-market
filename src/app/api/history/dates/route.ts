import { NextResponse } from "next/server";
import { listCompletedTradeDates } from "@/lib/server/prev-close";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const dates = await listCompletedTradeDates();
    return NextResponse.json({ dates, defaultDate: dates[0] ?? null });
  } catch (err) {
    const message = err instanceof Error ? err.message : "无法获取交易日列表";
    return NextResponse.json({ error: message, dates: [] }, { status: 502 });
  }
}
