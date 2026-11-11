export interface WatchGroup {
  id: string;
  name: string;
  codes: string[];
}

const KEY = "etf-market-watchlist-v1";

function fallback(): WatchGroup[] {
  return [{ id: "default", name: "默认分组", codes: [] }];
}

export function loadWatchlist(): WatchGroup[] {
  if (typeof window === "undefined") return fallback();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fallback();
    const parsed = JSON.parse(raw) as WatchGroup[];
    if (!Array.isArray(parsed) || parsed.length === 0) return fallback();
    return parsed.map((g) => ({
      id: String(g.id),
      name: String(g.name || "未命名"),
      codes: Array.isArray(g.codes) ? g.codes.map(String) : [],
    }));
  } catch {
    return fallback();
  }
}

export function saveWatchlist(groups: WatchGroup[]) {
  localStorage.setItem(KEY, JSON.stringify(groups));
}

export function allWatchCodes(groups: WatchGroup[]): string[] {
  return [...new Set(groups.flatMap((g) => g.codes))];
}

export function isWatched(groups: WatchGroup[], code: string): boolean {
  return groups.some((g) => g.codes.includes(code));
}

export function toggleWatch(groups: WatchGroup[], code: string, groupId?: string): WatchGroup[] {
  if (isWatched(groups, code)) {
    return groups.map((g) => ({ ...g, codes: g.codes.filter((c) => c !== code) }));
  }
  const target = groupId ?? groups[0]?.id ?? "default";
  return groups.map((g) => (g.id === target ? { ...g, codes: [...g.codes, code] } : g));
}
