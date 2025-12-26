import type { MoverResult, MarketOverviewResult } from '../../types.js';
import { BaseModule } from '../base-module.js';
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
export declare class MarketModule extends BaseModule {
    private scanInternal;
    getMovers(opts: MoversOptions): Promise<MoverResult[]>;
    getOverview(opts: MarketOverviewOptions): Promise<MarketOverviewResult[]>;
    getSectorMovers(opts: SectorMoversOptions): Promise<MoverResult[]>;
}
//# sourceMappingURL=market.module.d.ts.map