export const EASTMONEY_GATEWAY_UNAVAILABLE =
  "东方财富行情网关暂时不可用（502 或超时），请稍后刷新";

export const TENCENT_QUOTES_UNAVAILABLE = "腾讯行情接口暂时不可用，请稍后刷新";

export const BOTH_QUOTE_SOURCES_UNAVAILABLE =
  "东方财富行情网关暂时不可用（502 或超时），腾讯行情兜底也未能获取报价，请稍后刷新";

export const UNIVERSE_AND_QUOTES_UNAVAILABLE =
  "东方财富行情列表暂时不可用，备用名单与腾讯行情也未能获取，请稍后刷新";

export class UpstreamUnavailableError extends Error {
  readonly status: number | null;
  readonly sourceHost: string | null;

  constructor(message: string, opts?: { status?: number | null; sourceHost?: string | null; cause?: unknown }) {
    super(message);
    this.name = "UpstreamUnavailableError";
    this.status = opts?.status ?? null;
    this.sourceHost = opts?.sourceHost ?? null;
    if (opts?.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = opts.cause;
    }
  }
}

export function isAbortLike(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = "name" in err ? String((err as { name?: unknown }).name ?? "") : "";
  const message = "message" in err ? String((err as { message?: unknown }).message ?? "") : "";
  if (name === "AbortError" || name === "TimeoutError") return true;
  return /aborted|AbortError|The operation was aborted|This operation was aborted/i.test(message);
}

export function isTransientUpstreamError(err: unknown): boolean {
  if (err instanceof UpstreamUnavailableError) return true;
  if (isAbortLike(err)) return true;
  const message = err instanceof Error ? err.message : String(err ?? "");
  return /HTTP 50[23]\b/.test(message);
}

export function publicUpstreamMessage(err: unknown, fallback = "行情接口异常"): string {
  if (err instanceof UpstreamUnavailableError) return err.message;
  if (isTransientUpstreamError(err)) return EASTMONEY_GATEWAY_UNAVAILABLE;
  if (err instanceof Error && err.message.trim()) return err.message;
  return fallback;
}
