export type EtfCategory =
  | "宽基"
  | "行业"
  | "主题"
  | "跨境"
  | "商品"
  | "债券"
  | "货币"
  | "其他";

export type TradeStatus = "正常上市" | "暂停交易" | "终止上市" | "无行情";

export type DataFreshness = "交易时段（公开行情，可能延迟）" | "已收盘（日终行情）" | "非交易时段" | "接口异常";

export interface FundProfile {
  code: string;
  name: string | null;
  fundType: string | null;
  level2Class: string | null;
  indexCode: string | null;
  indexName: string | null;
  benchmark: string | null;
  managementFee: number | null;
  custodyFee: number | null;
  foundDate: string | null;
  orgName: string | null;
  fundManager: string | null;
  trustee: string | null;
  aum: number | null;
  aumDate: string | null;
  newShare: number | null;
  newShareDate: string | null;
  operateWay: string | null;
  strategy: string | null;
  trackingErrorTarget: string | null;
  updatedAt: number;
}

export interface IopvSnapshot {
  code: string;
  last: number | null;
  iopv: number | null;
  nav: number | null;
  quoteTime: number | null;
  updatedAt: number;
}

export interface EtfRow {
  code: string;
  name: string;
  market: 0 | 1;
  secid: string;
  exchange: "SZ" | "SH";
  category: EtfCategory;
  status: TradeStatus;
  last: number | null;
  change: number | null;
  changePct: number | null;
  turnover: number | null;
  volume: number | null;
  amplitude: number | null;
  turnoverRate: number | null;
  volumeRatio: number | null;
  high: number | null;
  low: number | null;
  open: number | null;
  prevClose: number | null;
  bid1: number | null;
  ask1: number | null;
  spread: number | null;
  iopv: number | null;
  nav: number | null;
  premiumPct: number | null;
  listedDate: string | null;
  quoteTime: number | null;
  ret5d: number | null;
  ret20d: number | null;
  ret60d: number | null;
  ret1y: number | null;
  fundType: string | null;
  level2Class: string | null;
  indexCode: string | null;
  indexName: string | null;
  benchmark: string | null;
  managementFee: number | null;
  custodyFee: number | null;
  foundDate: string | null;
  orgName: string | null;
  fundManager: string | null;
  trustee: string | null;
  aum: number | null;
  aumDate: string | null;
  trackingErrorTarget: string | null;
}

export interface CategoryStat {
  category: EtfCategory;
  count: number;
  up: number;
  down: number;
  flat: number;
  turnover: number;
  weightedReturn: number | null;
  equalReturn: number | null;
  representatives: { code: string; name: string; changePct: number | null; turnover: number | null }[];
}

export interface MarketOverview {
  totalCount: number;
  listedCount: number;
  pausedCount: number;
  delistedCount: number;
  noQuoteCount: number;
  totalAum: number;
  aumCoverage: number;
  totalTurnover: number;
  up: number;
  down: number;
  flat: number;
  topGainers: EtfRow[];
  topLosers: EtfRow[];
  topTurnover: EtfRow[];
  hotspots: { category: EtfCategory; weightedReturn: number | null; turnover: number; count: number }[];
}

export interface MarketPayload {
  source: string;
  fetchedAt: number;
  quoteTime: number | null;
  freshness: DataFreshness;
  delayed: boolean;
  f10Coverage: number;
  iopvCoverage: number;
  notes: string[];
  overview: MarketOverview;
  categories: CategoryStat[];
  list: EtfRow[];
}

export interface KlineBar {
  time: string;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
  amount: number;
  amplitude: number | null;
  changePct: number | null;
  change: number | null;
  turnoverRate: number | null;
}

export interface TrendPoint {
  time: string;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
  amount: number;
  avgPrice: number | null;
}

export interface EtfDetailPayload {
  source: string;
  fetchedAt: number;
  freshness: DataFreshness;
  delayed: boolean;
  row: EtfRow;
  iopvQuoteTime: number | null;
  notes: string[];
  warnings: { level: "info" | "warn"; text: string }[];
}

export const ALL_CATEGORIES: EtfCategory[] = [
  "宽基",
  "行业",
  "主题",
  "跨境",
  "商品",
  "债券",
  "货币",
  "其他",
];

export type SortKey = keyof EtfRow;
