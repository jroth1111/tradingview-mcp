import type { EarningsEvent, DividendEvent } from '../../types.js';
import { BaseModule } from '../base-module.js';
export interface CalendarOptions {
    daysAhead?: number;
    daysBack?: number;
    markets?: string[];
}
export declare class CalendarModule extends BaseModule {
    getEarnings(opts: CalendarOptions): Promise<EarningsEvent[]>;
    getDividends(opts: CalendarOptions): Promise<DividendEvent[]>;
}
//# sourceMappingURL=calendar.module.d.ts.map