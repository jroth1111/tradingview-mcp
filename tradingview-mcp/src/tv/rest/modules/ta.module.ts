import { SCAN_URL, SCAN_INDICATORS } from '../utils.js';
import type { RestContext } from '../context.js';
import { BaseModule } from '../base-module.js';

export interface TASummary {
  Other?: number;
  All?: number;
  MA?: number;
}

export class TAModule extends BaseModule {
  async summary(symbol: string, timeframe: string = "1D"): Promise<TASummary> {
    if (!symbol) throw new Error("symbol required");

    const tf = timeframe || "1D";
    const cols = SCAN_INDICATORS.map((i) => (tf !== "1D" ? `${i}|${tf}` : i));

    const body = {
      symbols: { tickers: [symbol], query: { types: [] } },
      columns: cols,
    };

    const resp = await this.fetch(SCAN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      throw new Error(`TA summary failed: ${resp.status} ${resp.statusText}`);
    }

    const data = (await resp.json()) as { data?: Array<{ d?: number[] }> };
    if (!data?.data?.[0]) return {};

    const summary: TASummary = {};
    const vals = data.data[0].d || [];

    cols.forEach((col, i) => {
      const key = col.split("|")[0].split(".").pop() as keyof TASummary;
      if (key) {
        summary[key] = Math.round(vals[i] * 1000) / 500;
      }
    });

    return summary;
  }
}
