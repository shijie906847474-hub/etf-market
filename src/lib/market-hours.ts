import type { DataFreshness } from "./types";

const SHANGHAI = "Asia/Shanghai";

function parts(ts = Date.now()) {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: SHANGHAI,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const map: Record<string, string> = {};
  for (const p of fmt.formatToParts(new Date(ts))) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  const hhmm = Number((map.hour ?? "00") + (map.minute ?? "00"));
  return { weekday: map.weekday ?? "", hhmm };
}

export function marketFreshness(now = Date.now()): { freshness: DataFreshness; delayed: boolean } {
  const { weekday, hhmm } = parts(now);
  const weekend = weekday === "Sat" || weekday === "Sun";
  if (weekend) return { freshness: "非交易时段", delayed: true };
  const inSession =
    (hhmm >= 915 && hhmm <= 1130) || (hhmm >= 1300 && hhmm <= 1505);
  if (inSession) return { freshness: "交易时段（公开行情，可能延迟）", delayed: true };
  if (hhmm > 1505) return { freshness: "已收盘（日终行情）", delayed: false };
  return { freshness: "非交易时段", delayed: true };
}
