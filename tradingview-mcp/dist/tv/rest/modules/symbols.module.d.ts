import { BaseModule } from '../base-module.js';
export interface SymbolSearchResult {
    id: string;
    exchange: string;
    fullExchange: string;
    symbol: string;
    description: string;
    type: string;
}
export declare class SymbolsModule extends BaseModule {
    search(query: string, filter?: string): Promise<SymbolSearchResult[]>;
}
//# sourceMappingURL=symbols.module.d.ts.map