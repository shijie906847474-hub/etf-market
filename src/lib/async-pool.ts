export async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  }
  const n = Math.min(Math.max(1, concurrency), items.length);
  if (n === 0) return [];
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out;
}

/**
 * 与 fetch 的 AbortController 叠加：即使底层套接字在 TLS/连接阶段
 * 不响应 abort，调用方也能在预算内继续，而不会占住全市场拉取的槽位。
 * 超时后仍会吞掉原 Promise 的后续结算，避免未处理拒绝。
 */
export function withHardTimeout<T>(promise: Promise<T>, ms: number, message = "操作超时"): Promise<T> {
  const budget = Math.max(1, Math.floor(ms));
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      promise.then(() => undefined, () => undefined);
      reject(new Error(message));
    }, budget);
    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
