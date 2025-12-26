import type { MarketOverviewResult, ScanResult } from '../../types.js';
import { BaseModule } from '../base-module.js';
import type { ScanOptions } from './scanner.module.js';
export interface BondOverviewOptions {
    limit?: number;
    sort?: string;
}
export declare class BondsModule extends BaseModule {
    private scanInternal;
    scan(opts: ScanOptions): Promise<ScanResult>;
    getOverview(opts: BondOverviewOptions): Promise<MarketOverviewResult[]>;
}
//# sourceMappingURL=bonds.module.d.ts.map