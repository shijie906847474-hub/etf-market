import { NextResponse } from "next/server";
import { deleteAllHistoryCache, deleteHistoryCache, listHistoryCache } from "@/lib/server/prev-close";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const items = listHistoryCache();
    return NextResponse.json({ items });
  } catch (err) {
    const message = err instanceof Error ? err.message : "无法读取历史缓存";
    return NextResponse.json({ error: message, items: [] }, { status: 502 });
  }
}

export async function DELETE(req: Request) {
  try {
    const url = new URL(req.url);
    const all = url.searchParams.get("all") === "1";
    const date = url.searchParams.get("date");
    if (all) {
      const result = deleteAllHistoryCache();
      return NextResponse.json({ ok: true, ...result });
    }
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: "请指定要删除的日期" }, { status: 400 });
    }
    const deleted = deleteHistoryCache(date);
    return NextResponse.json({ ok: true, deleted: deleted ? 1 : 0, date });
  } catch (err) {
    const message = err instanceof Error ? err.message : "删除缓存失败";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
