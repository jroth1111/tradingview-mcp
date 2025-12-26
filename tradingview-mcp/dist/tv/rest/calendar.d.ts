import type { EarningsEvent, DividendEvent } from '../types.js';
import type { TVRestClient } from './types.js';
export interface CalendarOptions {
    daysAhead?: number;
    daysBack?: number;
    markets?: string[];
}
export declare function getEarningsCalendar(client: TVRestClient, opts: CalendarOptions): Promise<EarningsEvent[]>;
export declare function getDividendCalendar(client: TVRestClient, opts: CalendarOptions): Promise<DividendEvent[]>;
//# sourceMappingURL=calendar.d.ts.map