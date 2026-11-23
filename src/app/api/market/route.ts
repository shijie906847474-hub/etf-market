import { NextResponse } from "next/server";
import type { LoadProgress } from "@/lib/load-progress";
import { publicUpstreamMessage } from "@/lib/providers/errors";
import { getMarketPayload } from "@/lib/server/market-service";
import { getHistoryPayload } from "@/lib/server/prev-close";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;
export const preferredRegion = "hkg1";

const PAD = `: ${" ".repeat(2048)}\n\n`;

function ssePacket(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n${PAD}`;
}

function errorBody(err: unknown) {
  return {
    error: publicUpstreamMessage(err),
    source: "东方财富公开行情",
    freshness: "接口异常",
  };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const view = url.searchParams.get("view");
  const stream =
    url.searchParams.get("stream") === "1" || (req.headers.get("accept") ?? "").includes("text/event-stream");

  if (!stream) {
    try {
      const data =
        view === "prev" || view === "history"
          ? await getHistoryPayload(url.searchParams.get("date"))
          : await getMarketPayload();
      return NextResponse.json(data);
    } catch (err) {
      return NextResponse.json(errorBody(err), { status: 502 });
    }
  }

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        if (req.signal.aborted) return;
        try {
          controller.enqueue(encoder.encode(ssePacket(event, data)));
        } catch {
          // client gone
        }
      };
      const onProgress = (p: LoadProgress) => send("progress", p);
      try {
        const data =
          view === "prev" || view === "history"
            ? await getHistoryPayload(url.searchParams.get("date"), onProgress)
            : await getMarketPayload(onProgress, (partial) => send("result", partial));
        send("result", data);
      } catch (err) {
        send("error", errorBody(err));
      } finally {
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
