import { rateLimitedFetch } from './utils.js';
export async function searchSymbols(client, query, filter) {
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
        headers: {
            Origin: "https://www.tradingview.com",
            Referer: "https://www.tradingview.com/"
        },
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
//# sourceMappingURL=symbols.js.map