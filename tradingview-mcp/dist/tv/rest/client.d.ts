import type { TVCredentials } from '../types.js';
import { TAModule } from './modules/ta.module.js';
import { SymbolsModule } from './modules/symbols.module.js';
import { NewsModule } from './modules/news.module.js';
import { FundamentalsModule } from './modules/fundamentals.module.js';
import { ScannerModule } from './modules/scanner.module.js';
import { OptionsModule } from './modules/options.module.js';
import { MarketModule } from './modules/market.module.js';
import { CalendarModule } from './modules/calendar.module.js';
import { BondsModule } from './modules/bonds.module.js';
import { IndicatorsModule } from './modules/indicators.module.js';
import { PineScriptModule } from './modules/pinescript.module.js';
export declare class TVRestClient {
    private ctx;
    readonly ta: TAModule;
    readonly symbols: SymbolsModule;
    readonly news: NewsModule;
    readonly fundamentals: FundamentalsModule;
    readonly scanner: ScannerModule;
    readonly options: OptionsModule;
    readonly market: MarketModule;
    readonly calendar: CalendarModule;
    readonly bonds: BondsModule;
    readonly indicators: IndicatorsModule;
    readonly pinescript: PineScriptModule;
    constructor(credentials?: TVCredentials);
    setCredentials(credentials: TVCredentials): void;
}
//# sourceMappingURL=client.d.ts.map