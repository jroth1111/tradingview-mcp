import { rateLimitedFetch } from './utils.js';
async function scanInternal(market, body) {
    const url = `https://scanner.tradingview.com/${market}/scan`;
    const resp = await rateLimitedFetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    if (!resp.ok) {
        throw new Error(`Scan failed: ${resp.status} ${resp.statusText}`);
    }
    return await resp.json();
}
export async function getMovers(client, opts) {
    const type = opts.type || "gainers";
    const limit = opts.limit ?? 10;
    const sortBy = type === "volume" ? "volume" : "change";
    const sortOrder = type === "losers" ? "asc" : "desc";
    const body = {
        filter: [{ left: "type", operation: "in", right: ["stock"] }],
        options: { lang: "en" },
        symbols: { tickers: [], query: { types: [] } },
        columns: [
            "name",
            "close",
            "change",
            "change_abs",
            "volume",
            "market_cap_basic",
            "type",
            "description",
            "exchange",
        ],
        sort: { sortBy, sortOrder },
    };
    const result = await scanInternal(opts.market || "america", body);
    return result.data?.map((item) => ({
        symbol: item.s,
        name: item.d?.[0]?.description,
        exchange: item.d?.[0]?.exchange,
        price: item.d?.[1],
        change: item.d?.[2],
        changeAbsolute: item.d?.[3],
        volume: item.d?.[4],
        marketCap: item.d?.[5],
    })) || [];
}
export async function getMarketOverview(client, opts) {
    const sortMap = {
        market_cap: "market_cap_basic",
        volume: "volume",
        change: "change",
        price: "close",
        volatility: "Volatility.D",
    };
    const sortField = sortMap[opts.sort || "market_cap"] || "market_cap_basic";
    const limit = opts.limit ?? 20;
    const body = {
        filter: [{ left: "type", operation: "in", right: ["stock"] }],
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
        ],
        sort: { sortBy: sortField, sortOrder: "desc" },
    };
    const result = await scanInternal(opts.market || "america", body);
    return result.data?.map((item) => ({
        symbol: item.s,
        name: item.d?.[0]?.description,
        exchange: item.d?.[0]?.exchange,
        price: item.d?.[1],
        change: item.d?.[2],
        volume: item.d?.[3],
        marketCap: item.d?.[4],
    })) || [];
}
export async function getSectorMovers(client, opts) {
    const type = opts.type || "gainers";
    const limit = opts.limit ?? 10;
    const sortBy = opts.sort || type === "volume" ? "volume" : "change";
    const sortOrder = type === "losers" ? "asc" : "desc";
    const filters = [{ left: "type", operation: "in", right: ["stock"] }];
    if (opts.sector) {
        filters.push({ left: "sector", operation: "match", right: opts.sector });
    }
    const body = {
        filter: filters,
        options: { lang: "en" },
        symbols: { tickers: [], query: { types: [] } },
        columns: [
            "name",
            "close",
            "change",
            "change_abs",
            "volume",
            "market_cap_basic",
            "sector",
            "description",
            "exchange",
        ],
        sort: { sortBy, sortOrder },
    };
    const result = await scanInternal(opts.market || "america", body);
    return result.data?.map((item) => ({
        symbol: item.s,
        name: item.d?.[0]?.description,
        exchange: item.d?.[0]?.exchange,
        price: item.d?.[1],
        change: item.d?.[2],
        changeAbsolute: item.d?.[3],
        volume: item.d?.[4],
        marketCap: item.d?.[5],
    })) || [];
}
//# sourceMappingURL=market.js.map