import { VOLUME_RATIO_SURGE } from "./format";
import type { EtfRow } from "./types";

/** 涨幅 / 跌幅 / 放量榜，规则与全市场 overview 一致，可按任意子集重算。 */
export interface RankBoards {
  topGainers: EtfRow[];
  topLosers: EtfRow[];
  topVolumeUp: EtfRow[];
  topVolumeDown: EtfRow[];
}

export function buildRankBoards(list: EtfRow[], limit = 5): RankBoards {
  const active = list.filter((x) => x.status !== "终止上市");
  const withPx = active.filter((x) => x.changePct !== null);
  const byRet = [...withPx].sort((a, b) => (b.changePct ?? 0) - (a.changePct ?? 0));
  const surged = active.filter(
    (x) =>
      x.status !== "暂停交易" &&
      x.status !== "停牌" &&
      x.volumeRatio !== null &&
      x.volumeRatio >= VOLUME_RATIO_SURGE &&
      x.changePct !== null,
  );
  const topVolumeUp = surged
    .filter((x) => (x.changePct ?? 0) > 0)
    .sort((a, b) => (b.changePct ?? 0) - (a.changePct ?? 0))
    .slice(0, limit);
  const topVolumeDown = surged
    .filter((x) => (x.changePct ?? 0) < 0)
    .sort((a, b) => (a.changePct ?? 0) - (b.changePct ?? 0))
    .slice(0, limit);
  return {
    topGainers: byRet.slice(0, limit),
    topLosers: [...byRet].reverse().slice(0, limit),
    topVolumeUp,
    topVolumeDown,
  };
}
