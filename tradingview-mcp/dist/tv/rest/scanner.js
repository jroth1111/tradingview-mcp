import { SCANNER_BASE } from './utils.js';
import { rateLimitedFetch } from './utils.js';
export async function scannerRequest(client, opts) {
    if (!opts.path)
        throw new Error("path required");
    if (opts.path.startsWith("http://") || opts.path.startsWith("https://")) {
        throw new Error("path must be relative to scanner.tradingview.com");
    }
    const normalizedPath = opts.path.replace(/^\/+/, "");
    const url = new URL(`${SCANNER_BASE}/${normalizedPath}`);
    if (opts.query) {
        for (const [key, value] of Object.entries(opts.query)) {
            if (Array.isArray(value)) {
                value.forEach(v => url.searchParams.append(key, String(v)));
            }
            else if (value !== undefined) {
                url.searchParams.set(key, String(value));
            }
        }
    }
    const method = opts.method === "GET" ? "GET" : "POST";
    const headers = {};
    const body = method === "POST" ? JSON.stringify(opts.payload ?? {}) : undefined;
    if (method === "POST") {
        headers["Content-Type"] = "application/json";
    }
    const resp = await rateLimitedFetch(url.toString(), { method, headers, body });
    if (!resp.ok) {
        throw new Error(`Scanner request failed: ${resp.status} ${resp.statusText}`);
    }
    const text = await resp.text();
    try {
        return JSON.parse(text);
    }
    catch {
        return { raw: text };
    }
}
export async function scan(client, opts) {
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
            : ["name", "close", "change", "volume", "market_cap_basic", "Recommend.All"],
        sort: opts.sortBy
            ? { sortBy: opts.sortBy, sortOrder: opts.sortOrder === "asc" ? "asc" : "desc" }
            : undefined,
    };
    const url = opts.labelProduct
        ? `https://scanner.tradingview.com/${market}/scan?label-product=${opts.labelProduct}`
        : `https://scanner.tradingview.com/${market}/scan`;
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
export async function getScannerMetainfo(client, opts) {
    const market = opts.market || "america";
    const url = new URL(`${SCANNER_BASE}/${market}/metainfo`);
    if (opts.labelProduct) {
        url.searchParams.set("label-product", opts.labelProduct);
    }
    const headers = {
        Origin: "https://www.tradingview.com",
        Referer: "https://www.tradingview.com/",
    };
    const body = opts.payload ? JSON.stringify(opts.payload) : undefined;
    const method = opts.payload ? "POST" : "GET";
    const resp = await rateLimitedFetch(url.toString(), { method, headers, body });
    if (!resp.ok) {
        throw new Error(`Scanner metainfo request failed: ${resp.status} ${resp.statusText}`);
    }
    return await resp.json();
}
export async function getScannerEnumOrdered(client, opts) {
    const url = new URL(`${SCANNER_BASE}/enum/ordered`);
    url.searchParams.set("id", opts.ids.join(","));
    if (opts.lang)
        url.searchParams.set("lang", opts.lang);
    if (opts.labelProduct)
        url.searchParams.set("label-product", opts.labelProduct);
    const resp = await rateLimitedFetch(url.toString(), {
        method: "GET",
        headers: { Origin: "https://www.tradingview.com", Referer: "https://www.tradingview.com/", Accept: "application/json" }
    });
    if (!resp.ok) {
        throw new Error(`Scanner enum request failed: ${resp.status} ${resp.statusText}`);
    }
    return await resp.json();
}
//# sourceMappingURL=scanner.js.map