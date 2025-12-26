import { rateLimitedFetch } from './utils.js';
async function scanInternal(market, body) {
    const url = `https://scanner.tradingview.com/${market}/scan`;
    const resp = await rateLimitedFetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    if (!resp.ok) {
        throw new Error(`Bonds scan failed: ${resp.status} ${resp.statusText}`);
    }
    return await resp.json();
}
export async function scanBonds(client, opts) {
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
    return await scanInternal(market, body);
}
export async function getBondMarketOverview(client, opts) {
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
    const result = await scanInternal("america", body);
    return result.data?.map((item) => ({
        symbol: item.s,
        name: item.d?.[0]?.description,
        exchange: item.d?.[0]?.exchange,
        close: item.d?.[1],
        change: item.d?.[2],
        change_abs: 0,
        volume: item.d?.[3],
        market_cap: item.d?.[4],
    })) || [];
}
//# sourceMappingURL=bonds.js.map