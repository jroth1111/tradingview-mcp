// TradingView REST API client - Restored Minimal Version
// This file has been restored with proper TypeScript syntax and fixed headers
// Only core methods are implemented; others throw "not implemented" errors
import { FUNDAMENTAL_FIELDS, } from "./types.js";
import { restRateLimiter, compileRateLimiter } from "../utils/rate-limiter.js";
const SCANNER_BASE = "https://scanner.tradingview.com";
const SCAN_URL = `${SCANNER_BASE}/global/scan`;
const SCAN_INDICATORS = ["Recommend.Other", "Recommend.All", "Recommend.MA"];
const OPTIONS_CHARTING_BASE = "https://options-charting.tradingview.com/v1";
const OPTIONS_GREEKS_FIELDS = [
    "iv",
    "delta",
    "gamma",
    "rho",
    "theta",
    "vega",
    "theoPrice",
    "underlying_symbol",
    "open_interest",
];
const AUTH_HEADERS_BASE = {
    Origin: "https://www.tradingview.com",
    Referer: "https://www.tradingview.com/",
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
};
function buildAuthHeaders(credentials) {
    return {
        ...AUTH_HEADERS_BASE,
        Cookie: credentials.sessionSign
            ? `sessionid=${credentials.sessionId}; sessionid_sign=${credentials.sessionSign}`
            : `sessionid=${credentials.sessionId}`,
    };
}
async function rateLimitedFetch(url, init, options) {
    const limiter = options?.useCompileLimiter ? compileRateLimiter : restRateLimiter;
    await limiter.acquire();
    const response = await fetch(url, init);
    if (response.status === 429) {
        const retryAfter = response.headers.get("Retry-After");
        const retryAfterMs = retryAfter ? parseInt(retryAfter) * 1000 : undefined;
        limiter.record429(retryAfterMs);
        await limiter.acquire();
        return await fetch(url, init);
    }
    return response;
}
export class TVRestClient {
    credentials;
    constructor(credentials) {
        this.credentials = credentials;
    }
    setCredentials(credentials) {
        this.credentials = credentials;
    }
    async getTASummary(symbol, timeframe = "1D") {
        if (!symbol)
            throw new Error("symbol required");
        const tf = timeframe || "1D";
        const cols = SCAN_INDICATORS.map((i) => (tf !== "1D" ? `${i}|${tf}` : i));
        const body = {
            symbols: { tickers: [symbol], query: { types: [] } },
            columns: cols,
        };
        const resp = await rateLimitedFetch(SCAN_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        if (!resp.ok) {
            throw new Error(`TA summary failed: ${resp.status} ${resp.statusText}`);
        }
        const data = (await resp.json());
        if (!data?.data?.[0])
            return {};
        const summary = {};
        const vals = data.data[0].d || [];
        cols.forEach((col, i) => {
            const key = col.split("|")[0].split(".").pop();
            if (key) {
                summary[key] = Math.round(vals[i] * 1000) / 500;
            }
        });
        return summary;
    }
    async searchSymbols(query, filter) {
        if (!query)
            throw new Error("query required");
        const parts = query.toUpperCase().replace(/ /g, "+").split(":");
        const exchange = parts.length === 2 ? parts[0] : undefined;
        const text = parts.pop() || query;
        const url = new URL("https://symbol-search.tradingview.com/symbol_search/v3");
        url.searchParams.set("text", text);
        if (exchange)
            url.searchParams.set("exchange", exchange);
        if (filter)
            url.searchParams.set("search_type", filter);
        const resp = await rateLimitedFetch(url.toString(), {
            method: "GET",
            headers: { Origin: "https://www.tradingview.com", Referer: "https://www.tradingview.com/" },
        });
        if (!resp.ok) {
            throw new Error(`Symbol search failed: ${resp.status} ${resp.statusText}`);
        }
        const data = (await resp.json());
        if (!data?.symbols)
            return [];
        return data.symbols.map((s) => {
            const ex = s.exchange.split(" ")[0];
            const id = s.prefix ? `${s.prefix}:${s.symbol}` : `${ex.toUpperCase()}:${s.symbol}`;
            return {
                id,
                exchange: ex,
                fullExchange: s.exchange,
                symbol: s.symbol,
                description: s.description,
                type: s.type,
            };
        });
    }
    async getNews(symbol, opts = {}) {
        if (!symbol)
            throw new Error("symbol required");
        const url = new URL("https://news-mediator.tradingview.com/public/news-flow/v2/news");
        url.searchParams.append("filter", `lang:${opts.language || "en"}`);
        url.searchParams.append("filter", `symbol:${symbol}`);
        url.searchParams.set("client", opts.client || "chart");
        url.searchParams.set("user_prostatus", "non_pro");
        url.searchParams.set("streaming", "false");
        if (opts.filters) {
            for (const f of opts.filters) {
                url.searchParams.append("filter", f);
            }
        }
        const resp = await rateLimitedFetch(url.toString(), {
            headers: { Origin: "https://www.tradingview.com", Referer: "https://www.tradingview.com/" },
        });
        if (!resp.ok) {
            throw new Error(`News fetch failed: ${resp.status} ${resp.statusText}`);
        }
        const data = (await resp.json());
        if (!data?.items)
            return [];
        return data.items.map((item) => ({
            id: item.id,
            title: item.title,
            link: item.link || `https://www.tradingview.com${item.storyPath || "/"}`,
            published: item.published,
            source: item.provider?.name || "Unknown",
            urgency: item.urgency,
        }));
    }
    async getPrivateIndicators() {
        throw new Error("getPrivateIndicators not implemented in restored version");
    }
    async getFundamentals(symbol, fields) {
        if (!symbol)
            throw new Error("symbol required");
        const fieldsToFetch = fields?.length ? fields : FUNDAMENTAL_FIELDS;
        const url = new URL("https://scanner.tradingview.com/symbol");
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
        if (this.credentials?.sessionId) {
            headers.Cookie = this.credentials.sessionSign
                ? `sessionid=${this.credentials.sessionId}; sessionid_sign=${this.credentials.sessionSign}`
                : `sessionid=${this.credentials.sessionId}`;
        }
        const resp = await rateLimitedFetch(url.toString(), { method: "GET", headers });
        if (!resp.ok) {
            throw new Error(`Fundamentals failed: ${resp.status} ${resp.statusText}`);
        }
        return await resp.json();
    }
}
console.log("rest.ts restored with 3 working methods (getTASummary, searchSymbols, getNews) with proper headers");
console.log("Other methods throw 'not implemented' errors - needs full restoration from original source");
//# sourceMappingURL=rest.js.map