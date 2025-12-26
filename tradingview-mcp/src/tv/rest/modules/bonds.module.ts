import type { MarketOverviewResult, ScanResult } from '../../types.js';
import type { RestContext } from '../context.js';
import { BaseModule } from '../base-module.js';
import { SCANNER_BASE, AUTH_HEADERS_BASE } from '../utils.js';
import type { ScanOptions } from './scanner.module.js';

export interface BondOverviewOptions {
  limit?: number;
  sort?: string;
}

export class BondsModule extends BaseModule {
  private async scanInternal(market: string, body: any): Promise<ScanResult> {
    const url = `https://scanner.tradingview.com/${market}/scan`;
    
    const resp = await this.fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    
    if (!resp.ok) {
      throw new Error(`Bonds scan failed: ${resp.status} ${resp.statusText}`);
    }
    
    return await resp.json() as ScanResult;
  }

  async scan(opts: ScanOptions): Promise<ScanResult> {
    const market = opts.market || "america";
    const body = {
      filter: opts.filter || [],
      options: { lang: "en" },
      symbols: {
        tickers: opts.symbols?.length ? opts.symbols : [],
        query: { types: [] },
      },
      columns: opts.columns?.length
        ? opts.columns
        : ["name", "close", "change", "volume", "description", "exchange", "type"],
      sort: opts.sortBy
        ? { sortBy: opts.sortBy, sortOrder: opts.sortOrder === "asc" ? "asc" : "desc" }
        : undefined,
    };
    
    const result = await this.scanInternal(market, body);
    // Ensure count matches data length
    return {
      count: result.data?.length ?? 0,
      data: result.data ?? [],
    };
  }

  async getOverview(opts: BondOverviewOptions): Promise<MarketOverviewResult[]> {
    const limit = opts.limit ?? 20;
    const sortBy = opts.sort || "volume";
    
    const body = {
      filter: [{ left: "type", operation: "match", right: "bond" }],
      options: { lang: "en" },
      symbols: { tickers: [], query: { types: [] } },
      columns: [
        "name",
        "close",
        "change",
        "volume",
        "market_cap_basic",
        "description",
        "exchange",
        "coupon",
        "maturity_date",
      ],
      sort: { sortBy, sortOrder: "desc" },
    };
    
    const result = await this.scanInternal("america", body);
    
    return result.data?.map((item: any) => ({
      symbol: item.s,
      name: item.d?.[0]?.description,
      exchange: item.d?.[0]?.exchange,
      close: item.d?.[1],
      change: item.d?.[2],
      change_abs: 0,
      volume: item.d?.[3],
      market_cap: item.d?.[4],
    })) || [] as MarketOverviewResult[];
  }
}
