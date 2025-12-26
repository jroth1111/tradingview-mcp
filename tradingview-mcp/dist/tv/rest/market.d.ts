import type { MoverResult, MarketOverviewResult } from '../types.js';
import type { TVRestClient } from './types.js';
export interface MoversOptions {
    market?: string;
    type?: "gainers" | "losers" | "volume";
    limit?: number;
}
export interface MarketOverviewOptions {
    market?: string;
    sort?: "market_cap" | "volume" | "change" | "price" | "volatility";
    limit?: number;
}
export interface SectorMoversOptions {
    market?: string;
    limit?: number;
    sort?: string;
    sector?: string;
    type?: "gainers" | "losers" | "volume";
}
export declare function getMovers(client: TVRestClient, opts: MoversOptions): Promise<MoverResult[]>;
export declare function getMarketOverview(client: TVRestClient, opts: MarketOverviewOptions): Promise<MarketOverviewResult[]>;
export declare function getSectorMovers(client: TVRestClient, opts: SectorMoversOptions): Promise<MoverResult[]>;
//# sourceMappingURL=market.d.ts.map