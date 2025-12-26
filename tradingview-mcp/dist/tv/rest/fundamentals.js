import { FUNDAMENTAL_FIELDS, SCAN_INDICATORS, SCANNER_BASE } from './utils.js';
import { rateLimitedFetch } from './utils.js';
export async function getFundamentals(client, symbol, fields) {
    if (!symbol)
        throw new Error("symbol required");
    const fieldsToFetch = fields?.length ? fields : FUNDAMENTAL_FIELDS;
    const url = new URL(`${SCANNER_BASE}/symbol`);
    url.searchParams.set("symbol", symbol);
    url.searchParams.set("fields", fieldsToFetch.join(","));
    url.searchParams.set("no_404", "true");
    url.searchParams.set("label-product", "symbol-info");
    const headers = {
        Origin: "https://www.tradingview.com",
        Referer: "https://www.tradingview.com/",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        Accept: "application/json",
    };
    if (client.credentials?.sessionId) {
        headers.Cookie = client.credentials.sessionSign
            ? `sessionid=${client.credentials.sessionId}; sessionid_sign=${client.credentials.sessionSign}`
            : `sessionid=${client.credentials.sessionId}`;
    }
    const resp = await rateLimitedFetch(url.toString(), { method: "GET", headers });
    if (!resp.ok) {
        throw new Error(`Fundamentals failed: ${resp.status} ${resp.statusText}`);
    }
    return await resp.json();
}
export async function getSymbolDetails(client, symbol) {
    if (!symbol)
        throw new Error("symbol required");
    const details = { symbol };
    // Fetch fundamentals
    try {
        details.fundamentals = await getFundamentals(client, symbol);
    }
    catch (e) {
        // Ignore if fundamentals fail
    }
    // Fetch performance
    try {
        const perfUrl = new URL(`${SCANNER_BASE}/symbol`);
        perfUrl.searchParams.set("symbol", symbol);
        perfUrl.searchParams.set("fields", "change,Perf.5D,Perf.W,Perf.1M,Perf.6M,Perf.YTD,Perf.Y,Perf.5Y,Perf.All");
        perfUrl.searchParams.set("no_404", "true");
        perfUrl.searchParams.set("label-product", "symbols-performance");
        const perfResp = await rateLimitedFetch(perfUrl.toString(), {
            method: "GET",
            headers: { Origin: "https://www.tradingview.com", Referer: "https://www.tradingview.com/", Accept: "application/json" }
        });
        if (perfResp.ok) {
            details.performance = await perfResp.json();
        }
    }
    catch (e) {
        // Ignore if performance fails
    }
    // Fetch technicals
    try {
        const taUrl = new URL(`${SCANNER_BASE}/symbol`);
        taUrl.searchParams.set("symbol", symbol);
        taUrl.searchParams.set("fields", SCAN_INDICATORS.join(","));
        taUrl.searchParams.set("no_404", "true");
        taUrl.searchParams.set("label-product", "symbols-technicals");
        const taResp = await rateLimitedFetch(taUrl.toString(), {
            method: "GET",
            headers: { Origin: "https://www.tradingview.com", Referer: "https://www.tradingview.com/", Accept: "application/json" }
        });
        if (taResp.ok) {
            details.technicals = await taResp.json();
        }
    }
    catch (e) {
        // Ignore if technicals fail
    }
    return details;
}
//# sourceMappingURL=fundamentals.js.map