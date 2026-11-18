import type { LoadProgress } from "@/lib/load-progress";
import type { MarketPayload } from "@/lib/types";

function isAbortError(err: unknown): boolean {
  return (err instanceof DOMException || err instanceof Error) && err.name === "AbortError";
}

export async function fetchMarketStream(
  url: string,
  onProgress: (p: LoadProgress) => void,
  signal?: AbortSignal,
): Promise<MarketPayload> {
  const res = await fetch(url, {
    cache: "no-store",
    signal,
    headers: { Accept: "text/event-stream" },
  });
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("text/event-stream")) {
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "行情加载失败");
    return json as MarketPayload;
  }
  if (!res.body) throw new Error("行情进度流不可用");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let result: MarketPayload | null = null;
  let streamError: string | null = null;

  const handleBlock = (block: string) => {
    let event = "message";
    const dataLines: string[] = [];
    for (const rawLine of block.split("\n")) {
      const line = rawLine.replace(/\r$/, "");
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
    }
    if (dataLines.length === 0) return;
    const parsed = JSON.parse(dataLines.join("\n")) as MarketPayload & LoadProgress & { error?: string };
    if (event === "progress") onProgress(parsed);
    else if (event === "result") result = parsed;
    else if (event === "error") streamError = parsed.error || "行情加载失败";
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const parts = buf.split("\n\n");
      buf = parts.pop() ?? "";
      for (const block of parts) {
        if (block.trim()) handleBlock(block);
      }
    }
    if (buf.trim()) handleBlock(buf);
  } catch (err) {
    if (isAbortError(err) || signal?.aborted) throw err;
    throw err;
  }

  if (streamError) throw new Error(streamError);
  if (!result) throw new Error(res.ok ? "行情进度流未返回完整数据" : "行情加载失败");
  return result;
}

export { isAbortError };
