import type { OptionsInTimeIV, OptionsVolatilityChartResponse } from '../../types.js';
import { BaseModule } from '../base-module.js';
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
export declare class OptionsModule extends BaseModule {
    getGreeks(symbol: string): Promise<OptionsGreeks>;
    getVolatilityChart(opts: VolatilityChartOptions): Promise<OptionsVolatilityChartResponse>;
    getInTimeIV(symbol: string): Promise<OptionsInTimeIV>;
}
//# sourceMappingURL=options.module.d.ts.map