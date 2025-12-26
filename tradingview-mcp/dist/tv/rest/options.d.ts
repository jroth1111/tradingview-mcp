import type { OptionsInTimeIV, OptionsVolatilityChartResponse } from '../types.js';
import type { TVRestClient } from './types.js';
export interface OptionsGreeks {
    symbol: string;
    iv?: number;
    delta?: number;
    gamma?: number;
    rho?: number;
    theta?: number;
    vega?: number;
    theoPrice?: number;
    underlyingSymbol?: string;
    openInterest?: number;
    [key: string]: unknown;
}
export interface VolatilityChartOptions {
    symbol: string;
    expiration: string;
    root?: string;
    xAxis?: string;
}
export declare function getOptionsGreeks(client: TVRestClient, symbol: string): Promise<OptionsGreeks>;
export declare function getOptionsVolatilityChart(client: TVRestClient, opts: VolatilityChartOptions): Promise<OptionsVolatilityChartResponse>;
export declare function getOptionsInTimeIV(client: TVRestClient, symbol: string): Promise<OptionsInTimeIV>;
//# sourceMappingURL=options.d.ts.map