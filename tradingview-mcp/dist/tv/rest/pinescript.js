import { rateLimitedFetch } from './utils.js';
export async function compilePineDraft(client, opts) {
    if (!opts.code || !opts.username)
        throw new Error("code and username required");
    const url = new URL("https://pine-facade.tradingview.com/translation/compilation");
    const headers = {
        Origin: "https://www.tradingview.com",
        Referer: "https://www.tradingview.com/",
        "Content-Type": "application/json",
    };
    if (client.credentials?.sessionId) {
        headers.Cookie = client.credentials.sessionSign
            ? `sessionid=${client.credentials.sessionId}; sessionid_sign=${client.credentials.sessionSign}`
            : `sessionid=${client.credentials.sessionId}`;
    }
    const body = {
        code: opts.code,
        username: opts.username,
        reuseDraft: opts.reuseDraft ?? false,
    };
    const resp = await rateLimitedFetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
    });
    if (!resp.ok) {
        throw new Error(`PineScript compilation failed: ${resp.status} ${resp.statusText}`);
    }
    return await resp.json();
}
export async function translatePineLight(client, opts) {
    if (!opts.code || !opts.username)
        throw new Error("code and username required");
    const indicId = opts.code.replace(/ |%/g, "%25");
    const version = opts.version || "last";
    const url = `https://pine-facade.tradingview.com/pine-facade/translate/${indicId}/${version}`;
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
        throw new Error(`PineScript translation failed: ${resp.status} ${resp.statusText}`);
    }
    return await resp.json();
}
//# sourceMappingURL=pinescript.js.map