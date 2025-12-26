import { SCANNER_BASE } from './utils.js';
import { rateLimitedFetch } from './utils.js';
export async function getEarningsCalendar(client, opts) {
    const daysAhead = opts.daysAhead ?? 7;
    const daysBack = opts.daysBack ?? 3;
    if (daysAhead + daysBack > 365) {
        throw new Error("Date range too large (daysAhead + daysBack must be <= 365)");
    }
    const markets = opts.markets || ["america"];
    const results = [];
    for (const market of markets) {
        const url = new URL(`${SCANNER_BASE}/${market}/earnings`);
        url.searchParams.set("from", String(daysBack));
        url.searchParams.set("to", String(daysAhead));
        const resp = await rateLimitedFetch(url.toString(), {
            method: "GET",
            headers: { Origin: "https://www.tradingview.com", Referer: "https://www.tradingview.com/", Accept: "application/json" }
        });
        if (resp.ok) {
            const data = await resp.json();
            if (data.items) {
                results.push(...data.items);
            }
        }
    }
    return results;
}
export async function getDividendCalendar(client, opts) {
    const daysAhead = opts.daysAhead ?? 7;
    const daysBack = opts.daysBack ?? 3;
    if (daysAhead + daysBack > 365) {
        throw new Error("Date range too large (daysAhead + daysBack must be <= 365)");
    }
    const markets = opts.markets || ["america"];
    const results = [];
    for (const market of markets) {
        const url = new URL(`${SCANNER_BASE}/${market}/dividends`);
        url.searchParams.set("from", String(daysBack));
        url.searchParams.set("to", String(daysAhead));
        const resp = await rateLimitedFetch(url.toString(), {
            method: "GET",
            headers: { Origin: "https://www.tradingview.com", Referer: "https://www.tradingview.com/", Accept: "application/json" }
        });
        if (resp.ok) {
            const data = await resp.json();
            if (data.items) {
                results.push(...data.items);
            }
        }
    }
    return results;
}
//# sourceMappingURL=calendar.js.map