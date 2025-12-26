import { BaseModule } from '../base-module.js';
export interface SymbolDetails {
    symbol: string;
    fundamentals?: Record<string, unknown>;
    performance?: Record<string, unknown>;
    technicals?: Record<string, unknown>;
    [key: string]: unknown;
}
export declare class FundamentalsModule extends BaseModule {
    get(symbol: string, fields?: string[]): Promise<Record<string, unknown>>;
    getDetails(symbol: string): Promise<SymbolDetails>;
}
//# sourceMappingURL=fundamentals.module.d.ts.map