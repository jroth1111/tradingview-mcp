import type { RestContext } from '../context.js';
import { BaseModule } from '../base-module.js';
import { FUNDAMENTAL_FIELDS, SCAN_INDICATORS, SCANNER_BASE, AUTH_HEADERS_BASE } from '../utils.js';

export interface SymbolDetails {
  symbol: string;
  fundamentals?: Record<string, unknown>;
  performance?: Record<string, unknown>;
  technicals?: Record<string, unknown>;
  [key: string]: unknown;
}

export class FundamentalsModule extends BaseModule {
  async get(symbol: string, fields?: string[]): Promise<Record<string, unknown>> {
    if (!symbol) throw new Error("symbol required");
    
    const fieldsToFetch = fields?.length ? fields : FUNDAMENTAL_FIELDS;
    const url = new URL(`${SCANNER_BASE}/symbol`);
    url.searchParams.set("symbol", symbol);
    url.searchParams.set("fields", fieldsToFetch.join(","));
    url.searchParams.set("no_404", "true");
    url.searchParams.set("label-product", "symbol-info");
    
    const headers: Record<string, string> = {
      Origin: AUTH_HEADERS_BASE.Origin,
      Referer: AUTH_HEADERS_BASE.Referer,
      "User-Agent": AUTH_HEADERS_BASE["User-Agent"],
      Accept: "application/json",
    };
    
    if (this.ctx.credentials?.sessionId) {
      headers.Cookie = this.ctx.credentials.sessionSign
        ? `sessionid=${this.ctx.credentials.sessionId}; sessionid_sign=${this.ctx.credentials.sessionSign}`
        : `sessionid=${this.ctx.credentials.sessionId}`;
    }
    
    const resp = await this.fetch(url.toString(), { method: "GET", headers });
    
    if (!resp.ok) {
      throw new Error(`Fundamentals failed: ${resp.status} ${resp.statusText}`);
    }
    
    return await resp.json() as Record<string, unknown>;
  }

  async getDetails(symbol: string): Promise<SymbolDetails> {
    if (!symbol) throw new Error("symbol required");
    
    const details: Record<string, unknown> = { symbol };
    
    try {
      details.fundamentals = await this.get(symbol);
    } catch (e) {
      // Ignore if fundamentals fail
    }
    
    try {
      const perfUrl = new URL(`${SCANNER_BASE}/symbol`);
      perfUrl.searchParams.set("symbol", symbol);
      perfUrl.searchParams.set("fields", "change,Perf.5D,Perf.W,Perf.1M,Perf.6M,Perf.YTD,Perf.Y,Perf.5Y,Perf.All");
      perfUrl.searchParams.set("no_404", "true");
      perfUrl.searchParams.set("label-product", "symbols-performance");
      
      const perfResp = await this.fetch(perfUrl.toString(), {
        method: "GET",
        headers: { Origin: AUTH_HEADERS_BASE.Origin, Referer: AUTH_HEADERS_BASE.Referer, Accept: "application/json" }
      });
      
      if (perfResp.ok) {
        details.performance = await perfResp.json();
      }
    } catch (e) {
      // Ignore if performance fails
    }
    
    try {
      const taUrl = new URL(`${SCANNER_BASE}/symbol`);
      taUrl.searchParams.set("symbol", symbol);
      taUrl.searchParams.set("fields", SCAN_INDICATORS.join(","));
      taUrl.searchParams.set("no_404", "true");
      taUrl.searchParams.set("label-product", "symbols-technicals");
      
      const taResp = await this.fetch(taUrl.toString(), {
        method: "GET",
        headers: { Origin: AUTH_HEADERS_BASE.Origin, Referer: AUTH_HEADERS_BASE.Referer, Accept: "application/json" }
      });
      
      if (taResp.ok) {
        details.technicals = await taResp.json();
      }
    } catch (e) {
      // Ignore if technicals fail
    }
    
    return details as SymbolDetails;
  }
}
