import type { TVCredentials } from "./types.js";
export interface TASummary {
    Other?: number;
    All?: number;
    MA?: number;
}
export interface SymbolSearchResult {
    id: string;
    exchange: string;
    fullExchange: string;
    symbol: string;
    description: string;
    type: string;
}
export declare class TVRestClient {
    private credentials?;
    constructor(credentials?: TVCredentials);
    setCredentials(credentials: TVCredentials): void;
    getTASummary(symbol: string, timeframe?: string): Promise<TASummary>;
    searchSymbols(query: string, filter?: string): Promise<SymbolSearchResult[]>;
    getNews(symbol: string, opts?: {
        language?: string;
        limit?: number;
        client?: string;
        filters?: string[];
    }): Promise<Array<{
        id: string;
        title: string;
        link: string;
        published: number;
        source: string;
        urgency?: number;
    }>>;
    getPrivateIndicators(): Promise<Array<{
        id: string;
        version: string;
        name: string;
        access: string;
        type: string;
    }>>;
    getFundamentals(symbol: string, fields?: string[]): Promise<Record<string, unknown>>;
}
//# sourceMappingURL=rest.d.ts.map