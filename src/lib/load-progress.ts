export type LoadProgressStage = "universe" | "f10" | "nav" | "asOfDate" | "klines" | "assemble" | "cached";

export type LoadProgress = {
  stage: LoadProgressStage;
  label: string;
  done: number;
  total: number;
  percent: number;
};

export function stagePercent(start: number, end: number, done: number, total: number): number {
  if (!(total > 0)) return start;
  const t = Math.min(Math.max(done, 0), total) / total;
  return Math.round(start + (end - start) * t);
}

export function throttleProgress(fn: (p: LoadProgress) => void, ms = 200): (p: LoadProgress) => void {
  let last = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: LoadProgress | null = null;
  const flush = () => {
    timer = null;
    last = Date.now();
    if (pending) {
      const q = pending;
      pending = null;
      fn(q);
    }
  };
  return (p: LoadProgress) => {
    const now = Date.now();
    const immediate = last === 0 || p.percent >= 100 || (p.total > 0 && p.done >= p.total) || now - last >= ms;
    if (immediate) {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      pending = null;
      last = now;
      fn(p);
      return;
    }
    pending = p;
    if (!timer) timer = setTimeout(flush, ms - (now - last));
  };
}
