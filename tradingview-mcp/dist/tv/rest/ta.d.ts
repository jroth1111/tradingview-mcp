import type { TVRestClient } from './types.js';
export interface TASummary {
    Other?: number;
    All?: number;
    MA?: number;
}
export declare function getTASummary(client: TVRestClient, symbol: string, timeframe?: string): Promise<TASummary>;
//# sourceMappingURL=ta.d.ts.map