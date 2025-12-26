import { rateLimitedFetch } from './utils.js';
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
export class TVRestClient {
    ctx;
    // Composed modules as readonly properties ✅
    ta;
    symbols;
    news;
    fundamentals;
    scanner;
    options;
    market;
    calendar;
    bonds;
    indicators;
    pinescript;
    constructor(credentials) {
        this.ctx = {
            credentials,
            fetch: rateLimitedFetch,
        };
        // Initialize modules with context ✅
        this.ta = new TAModule(this.ctx);
        this.symbols = new SymbolsModule(this.ctx);
        this.news = new NewsModule(this.ctx);
        this.fundamentals = new FundamentalsModule(this.ctx);
        this.scanner = new ScannerModule(this.ctx);
        this.options = new OptionsModule(this.ctx);
        this.market = new MarketModule(this.ctx);
        this.calendar = new CalendarModule(this.ctx);
        this.bonds = new BondsModule(this.ctx);
        this.indicators = new IndicatorsModule(this.ctx);
        this.pinescript = new PineScriptModule(this.ctx);
    }
    setCredentials(credentials) {
        this.ctx.credentials = credentials;
    }
}
//# sourceMappingURL=client.js.map