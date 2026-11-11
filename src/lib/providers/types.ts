import type { FundProfile, IopvSnapshot, KlineBar, TrendPoint } from "../types";

export interface QuoteRaw {
  code: string;
  market: 0 | 1;
  name: string;
  last: number | null;
  change: number | null;
  changePct: number | null;
  volume: number | null;
  turnover: number | null;
  amplitude: number | null;
  turnoverRate: number | null;
  volumeRatio: number | null;
  high: number | null;
  low: number | null;
  open: number | null;
  prevClose: number | null;
  bid1: number | null;
  ask1: number | null;
  listedDateRaw: string | number | null;
  quoteTime: number | null;
  ret5d: number | null;
  ret20d: number | null;
  ret60d: number | null;
  ret1y: number | null;
  ytdChangePct: number | null;
  statusHint: number | null;
}

export interface OfficialNav {
  code: string;
  date: string;
  nav: number;
}

export interface MarketDataProvider {
  id: string;
  label: string;
  fetchUniverse(): Promise<{ total: number; quotes: QuoteRaw[] }>;
  fetchIopv(secid: string): Promise<IopvSnapshot>;
  fetchFundProfile(code: string): Promise<FundProfile | null>;
  fetchFundProfiles(codes: string[]): Promise<FundProfile[]>;
  fetchKline(secid: string, klt: 101 | 102 | 103, limit?: number): Promise<KlineBar[]>;
  fetchTrends(secid: string): Promise<{ preClose: number | null; points: TrendPoint[] }>;
  fetchOfficialNav(code: string, asOfDate: string): Promise<OfficialNav | null>;
}
