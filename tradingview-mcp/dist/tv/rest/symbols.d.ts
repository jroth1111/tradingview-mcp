import type { TVRestClient } from './types.js';
export interface SymbolSearchResult {
    id: string;
    exchange: string;
    fullExchange: string;
    symbol: string;
    description: string;
    type: string;
}
export declare function searchSymbols(client: TVRestClient, query: string, filter?: string): Promise<SymbolSearchResult[]>;
//# sourceMappingURL=symbols.d.ts.map