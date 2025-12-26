import { OPTIONS_GREEKS_FIELDS, OPTIONS_CHARTING_BASE, SCANNER_BASE } from './utils.js';
import { rateLimitedFetch } from './utils.js';
export async function getOptionsGreeks(client, symbol) {
    if (!symbol)
        throw new Error("symbol required");
    const url = new URL(`${SCANNER_BASE}/symbol`);
    url.searchParams.set("symbol", symbol);
    url.searchParams.set("fields", OPTIONS_GREEKS_FIELDS.join(","));
    url.searchParams.set("no_404", "true");
    url.searchParams.set("label-product", "symbol-info");
    const headers = {
        Origin: "https://www.tradingview.com",
        Referer: "https://www.tradingview.com/",
        Accept: "application/json",
    };
    if (client.credentials?.sessionId) {
        headers.Cookie = client.credentials.sessionSign
            ? `sessionid=${client.credentials.sessionId}; sessionid_sign=${client.credentials.sessionSign}`
            : `sessionid=${client.credentials.sessionId}`;
    }
    const resp = await rateLimitedFetch(url.toString(), { method: "GET", headers });
    if (!resp.ok) {
        throw new Error(`Options Greeks failed: ${resp.status} ${resp.statusText}`);
    }
    const data = await resp.json();
    return {
        symbol,
        iv: data.iv,
        delta: data.delta,
        gamma: data.gamma,
        rho: data.rho,
        theta: data.theta,
        vega: data.vega,
        theoPrice: data.theoPrice,
        underlyingSymbol: data.underlying_symbol,
        openInterest: data.open_interest,
    };
}
export async function getOptionsVolatilityChart(client, opts) {
    const { symbol, expiration, root = "underlying", xAxis = "strike" } = opts;
    if (!symbol || !expiration)
        throw new Error("symbol and expiration required");
    const url = new URL(`${OPTIONS_CHARTING_BASE}/volatility-chart/${root}/${xAxis}`);
    url.searchParams.set("symbol", symbol);
    url.searchParams.set("expiration", expiration);
    const headers = {
        Origin: "https://www.tradingview.com",
        Referer: "https://www.tradingview.com/",
        Accept: "application/json",
    };
    const resp = await rateLimitedFetch(url.toString(), { method: "GET", headers });
    if (!resp.ok) {
        throw new Error(`Options Volatility Chart failed: ${resp.status} ${resp.statusText}`);
    }
    return await resp.json();
}
export async function getOptionsInTimeIV(client, symbol) {
    if (!symbol)
        throw new Error("symbol required");
    const url = new URL(`${OPTIONS_CHARTING_BASE}/iv-term-structure/underlying/strike`);
    url.searchParams.set("symbol", symbol);
    const headers = {
        Origin: "https://www.tradingview.com",
        Referer: "https://www.tradingview.com/",
        Accept: "application/json",
    };
    const resp = await rateLimitedFetch(url.toString(), { method: "GET", headers });
    if (!resp.ok) {
        throw new Error(`Options IV Term Structure failed: ${resp.status} ${resp.statusText}`);
    }
    return await resp.json();
}
//# sourceMappingURL=options.js.map