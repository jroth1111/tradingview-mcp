import type { TVRestClient } from './types.js';
export interface SymbolDetails {
    symbol: string;
    fundamentals?: Record<string, unknown>;
    performance?: Record<string, unknown>;
    greeks?: Record<string, unknown>;
    technicals?: Record<string, unknown>;
    [key: string]: unknown;
}
export declare function getFundamentals(client: TVRestClient, symbol: string, fields?: string[]): Promise<Record<string, unknown>>;
export declare function getSymbolDetails(client: TVRestClient, symbol: string): Promise<SymbolDetails>;
//# sourceMappingURL=fundamentals.d.ts.map