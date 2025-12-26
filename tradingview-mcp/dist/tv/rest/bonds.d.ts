import type { MarketOverviewResult } from '../types.js';
import type { TVRestClient } from './types.js';
export interface BondOverviewOptions {
    limit?: number;
    sort?: string;
}
interface ScanResult {
    data?: any[];
}
export declare function scanBonds(client: TVRestClient, opts: any): Promise<ScanResult>;
export declare function getBondMarketOverview(client: TVRestClient, opts: BondOverviewOptions): Promise<MarketOverviewResult[]>;
export {};
//# sourceMappingURL=bonds.d.ts.map