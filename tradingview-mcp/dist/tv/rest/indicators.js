import { rateLimitedFetch } from './utils.js';
export async function searchIndicators(client, query) {
    if (!query)
        throw new Error("query required");
    const norm = (s) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const builtIns = [];
    // Fetch built-in indicators for multiple filters
    for (const filter of ["standard", "candlestick", "fundamental"]) {
        try {
            const url = new URL("https://pine-facade.tradingview.com/pine-facade/list");
            url.searchParams.set("filter", filter);
            const resp = await rateLimitedFetch(url.toString(), {
                method: "GET",
                headers: { Origin: "https://www.tradingview.com", Referer: "https://www.tradingview.com/", Accept: "application/json" }
            });
            if (resp.ok) {
                const data = (await resp.json());
                const matches = data
                    .filter(i => norm(i.scriptName).includes(norm(query)) ||
                    norm(i.extra?.shortDescription || "").includes(norm(query)))
                    .map(ind => ({
                    id: ind.scriptIdPart,
                    version: ind.version,
                    name: ind.scriptName,
                    author: { username: "@TRADINGVIEW@" },
                    access: "closed_source",
                    type: (ind.extra?.kind || "study"),
                }));
                builtIns.push(...matches);
            }
        }
        catch {
            // Continue on error
        }
    }
    // Fetch public scripts
    const pubMatches = [];
    try {
        const pubUrl = new URL("https://www.tradingview.com/pubscripts-suggest-json");
        pubUrl.searchParams.set("search", encodeURIComponent(query));
        const pubResp = await rateLimitedFetch(pubUrl.toString(), {
            method: "GET",
            headers: { Origin: "https://www.tradingview.com", Referer: "https://www.tradingview.com/", Accept: "application/json" }
        });
        if (pubResp.ok) {
            const pubData = (await pubResp.json());
            if (pubData.results) {
                const accessMap = ["open_source", "closed_source", "invite_only"];
                pubMatches.push(...(pubData.results.map(ind => ({
                    id: ind.scriptIdPart,
                    version: ind.version,
                    name: ind.scriptName,
                    author: { username: ind.author?.username || "unknown" },
                    access: (accessMap[(ind.access || 1) - 1] || "other"),
                    type: (ind.extra?.kind || "study"),
                }))));
            }
        }
    }
    catch {
        // Continue on error
    }
    return [...builtIns, ...pubMatches];
}
export async function getIndicatorMeta(client, id, version = "last") {
    if (!id)
        throw new Error("id required");
    const indicId = id.replace(/ |%/g, "%25");
    const url = `https://pine-facade.tradingview.com/pine-facade/translate/${indicId}/${version}`;
    const headers = {};
    if (client.credentials?.sessionId) {
        headers.Cookie = client.credentials.sessionSign
            ? `sessionid=${client.credentials.sessionId}; sessionid_sign=${client.credentials.sessionSign}`
            : `sessionid=${client.credentials.sessionId}`;
    }
    const resp = await rateLimitedFetch(url, { method: "GET", headers });
    if (!resp.ok) {
        throw new Error(`Indicator fetch failed: ${resp.status} ${resp.statusText}`);
    }
    return await resp.json();
}
export async function getPrivateIndicators(client) {
    const url = "https://www.tradingview.com/user-scripts/JSON/";
    const headers = {
        Origin: "https://www.tradingview.com",
        Referer: "https://www.tradingview.com/",
    };
    if (client.credentials?.sessionId) {
        headers.Cookie = client.credentials.sessionSign
            ? `sessionid=${client.credentials.sessionId}; sessionid_sign=${client.credentials.sessionSign}`
            : `sessionid=${client.credentials.sessionId}`;
    }
    const resp = await rateLimitedFetch(url, { method: "GET", headers });
    if (!resp.ok) {
        throw new Error(`Private indicators fetch failed: ${resp.status} ${resp.statusText}`);
    }
    return await resp.json();
}
//# sourceMappingURL=indicators.js.map