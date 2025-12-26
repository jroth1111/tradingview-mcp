import type { EarningsEvent, DividendEvent } from '../../types.js';
import type { RestContext } from '../context.js';
import { BaseModule } from '../base-module.js';
import { SCANNER_BASE, AUTH_HEADERS_BASE } from '../utils.js';

export interface CalendarOptions {
  daysAhead?: number;
  daysBack?: number;
  markets?: string[];
}

export class CalendarModule extends BaseModule {
  async getEarnings(opts: CalendarOptions): Promise<EarningsEvent[]> {
    const daysAhead = opts.daysAhead ?? 7;
    const daysBack = opts.daysBack ?? 3;
    
    if (daysAhead + daysBack > 365) {
      throw new Error("Date range too large (daysAhead + daysBack must be <= 365)");
    }
    
    const markets = opts.markets || ["america"];
    const results: EarningsEvent[] = [];
    
    for (const market of markets) {
      const url = new URL(`${SCANNER_BASE}/${market}/earnings`);
      url.searchParams.set("from", String(daysBack));
      url.searchParams.set("to", String(daysAhead));
      
      const resp = await this.fetch(url.toString(), {
        method: "GET",
        headers: { Origin: AUTH_HEADERS_BASE.Origin, Referer: AUTH_HEADERS_BASE.Referer, Accept: "application/json" }
      });
      
      if (resp.ok) {
        const data = await resp.json() as { items?: EarningsEvent[] };
        if (data.items) {
          results.push(...data.items);
        }
      }
    }
    
    return results;
  }

  async getDividends(opts: CalendarOptions): Promise<DividendEvent[]> {
    const daysAhead = opts.daysAhead ?? 7;
    const daysBack = opts.daysBack ?? 3;
    
    if (daysAhead + daysBack > 365) {
      throw new Error("Date range too large (daysAhead + daysBack must be <= 365)");
    }
    
    const markets = opts.markets || ["america"];
    const results: DividendEvent[] = [];
    
    for (const market of markets) {
      const url = new URL(`${SCANNER_BASE}/${market}/dividends`);
      url.searchParams.set("from", String(daysBack));
      url.searchParams.set("to", String(daysAhead));
      
      const resp = await this.fetch(url.toString(), {
        method: "GET",
        headers: { Origin: AUTH_HEADERS_BASE.Origin, Referer: AUTH_HEADERS_BASE.Referer, Accept: "application/json" }
      });
      
      if (resp.ok) {
        const data = await resp.json() as { items?: DividendEvent[] };
        if (data.items) {
          results.push(...data.items);
        }
      }
    }
    
    return results;
  }
}
