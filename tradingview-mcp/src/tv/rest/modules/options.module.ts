import type { OptionsInTimeIV, OptionsVolatilityChartResponse } from '../../types.js';
import type { RestContext } from '../context.js';
import { BaseModule } from '../base-module.js';
import { OPTIONS_GREEKS_FIELDS, OPTIONS_CHARTING_BASE, SCANNER_BASE, AUTH_HEADERS_BASE } from '../utils.js';

export interface OptionsGreeks {
  symbol: string;
  iv?: number;
  delta?: number;
  gamma?: number;
  rho?: number;
  theta?: number;
  vega?: number;
  theoPrice?: number;
  underlyingSymbol?: string;
  openInterest?: number;
  [key: string]: unknown;
}

export interface VolatilityChartOptions {
  symbol: string;
  expiration: string;
  root?: string;
  xAxis?: string;
}

export class OptionsModule extends BaseModule {
  async getGreeks(symbol: string): Promise<OptionsGreeks> {
    if (!symbol) throw new Error("symbol required");
    
    const url = new URL(`${SCANNER_BASE}/symbol`);
    url.searchParams.set("symbol", symbol);
    url.searchParams.set("fields", OPTIONS_GREEKS_FIELDS.join(","));
    url.searchParams.set("no_404", "true");
    url.searchParams.set("label-product", "symbol-info");
    
    const headers: Record<string, string> = {
      Origin: AUTH_HEADERS_BASE.Origin,
      Referer: AUTH_HEADERS_BASE.Referer,
      Accept: "application/json",
    };
    
    if (this.ctx.credentials?.sessionId) {
      headers.Cookie = this.ctx.credentials.sessionSign
        ? `sessionid=${this.ctx.credentials.sessionId}; sessionid_sign=${this.ctx.credentials.sessionSign}`
        : `sessionid=${this.ctx.credentials.sessionId}`;
    }
    
    const resp = await this.fetch(url.toString(), { method: "GET", headers });
    
    if (!resp.ok) {
      throw new Error(`Options Greeks failed: ${resp.status} ${resp.statusText}`);
    }
    
    const data = await resp.json() as Record<string, unknown>;
    
    return {
      symbol,
      iv: data.iv as number,
      delta: data.delta as number,
      gamma: data.gamma as number,
      rho: data.rho as number,
      theta: data.theta as number,
      vega: data.vega as number,
      theoPrice: data.theoPrice as number,
      underlyingSymbol: data.underlying_symbol as string,
      openInterest: data.open_interest as number,
    };
  }

  async getVolatilityChart(opts: VolatilityChartOptions): Promise<OptionsVolatilityChartResponse> {
    const { symbol, expiration, root = "underlying", xAxis = "strike" } = opts;
    if (!symbol || !expiration) throw new Error("symbol and expiration required");
    
    const url = new URL(`${OPTIONS_CHARTING_BASE}/volatility-chart/${root}/${xAxis}`);
    url.searchParams.set("symbol", symbol);
    url.searchParams.set("expiration", expiration);
    
    const headers: Record<string, string> = {
      Origin: AUTH_HEADERS_BASE.Origin,
      Referer: AUTH_HEADERS_BASE.Referer,
      Accept: "application/json",
    };
    
    const resp = await this.fetch(url.toString(), { method: "GET", headers });
    
    if (!resp.ok) {
      throw new Error(`Options Volatility Chart failed: ${resp.status} ${resp.statusText}`);
    }
    
    return await resp.json() as OptionsVolatilityChartResponse;
  }

  async getInTimeIV(symbol: string): Promise<OptionsInTimeIV> {
    if (!symbol) throw new Error("symbol required");
    
    const url = new URL(`${OPTIONS_CHARTING_BASE}/iv-term-structure/underlying/strike`);
    url.searchParams.set("symbol", symbol);
    
    const headers: Record<string, string> = {
      Origin: AUTH_HEADERS_BASE.Origin,
      Referer: AUTH_HEADERS_BASE.Referer,
      Accept: "application/json",
    };
    
    const resp = await this.fetch(url.toString(), { method: "GET", headers });
    
    if (!resp.ok) {
      throw new Error(`Options IV Term Structure failed: ${resp.status} ${resp.statusText}`);
    }
    
    return await resp.json() as OptionsInTimeIV;
  }
}
