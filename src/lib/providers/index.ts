import { eastMoneyProvider } from "./eastmoney";
import type { MarketDataProvider } from "./types";

export function getMarketProvider(): MarketDataProvider {
  return eastMoneyProvider;
}

export type { MarketDataProvider } from "./types";
