import { BaseModule } from '../base-module.js';
import { AUTH_HEADERS_BASE } from '../utils.js';
export class IndicatorsModule extends BaseModule {
    async search(query) {
        if (!query)
            throw new Error("query required");
        const norm = (s) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
        const builtIns = [];
        // Fetch built-in indicators for multiple filters
        for (const filter of ["standard", "candlestick", "fundamental"]) {
            try {
                const url = new URL("https://pine-facade.tradingview.com/pine-facade/list");
                url.searchParams.set("filter", filter);
                const resp = await this.fetch(url.toString(), {
                    method: "GET",
                    headers: { Origin: AUTH_HEADERS_BASE.Origin, Referer: AUTH_HEADERS_BASE.Referer, Accept: "application/json" }
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
            const pubResp = await this.fetch(pubUrl.toString(), {
                method: "GET",
                headers: { Origin: AUTH_HEADERS_BASE.Origin, Referer: AUTH_HEADERS_BASE.Referer, Accept: "application/json" }
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
        // Fetch private/saved scripts if authenticated
        const privateMatches = [];
        if (this.ctx.credentials?.sessionId) {
            try {
                const privateIndicators = await this.getPrivate();
                const matches = privateIndicators
                    .filter(i => norm(i.name).includes(norm(query)) || norm(i.title).includes(norm(query)))
                    .map(ind => ({
                    id: ind.id,
                    version: ind.version,
                    name: ind.name,
                    author: { username: "@USER@" },
                    access: "closed_source",
                    type: (ind.type || "study"),
                }));
                privateMatches.push(...matches);
            }
            catch {
                // Continue on error - user may not have private scripts
            }
        }
        return [...privateMatches, ...builtIns, ...pubMatches];
    }
    async getMeta(id, version = "last") {
        if (!id)
            throw new Error("id required");
        const indicId = id.replace(/ |%/g, "%25");
        const url = `https://pine-facade.tradingview.com/pine-facade/translate/${indicId}/${version}`;
        const headers = {};
        if (this.ctx.credentials?.sessionId) {
            headers.Cookie = this.ctx.credentials.sessionSign
                ? `sessionid=${this.ctx.credentials.sessionId}; sessionid_sign=${this.ctx.credentials.sessionSign}`
                : `sessionid=${this.ctx.credentials.sessionId}`;
        }
        const resp = await this.fetch(url, { method: "GET", headers });
        if (!resp.ok) {
            throw new Error(`Indicator fetch failed: ${resp.status} ${resp.statusText}`);
        }
        return await resp.json();
    }
    async getPrivate() {
        // Use the correct endpoint as verified via Chrome DevTools
        const url = "https://pine-facade.tradingview.com/pine-facade/list?filter=saved";
        const headers = {
            Origin: AUTH_HEADERS_BASE.Origin,
            Referer: AUTH_HEADERS_BASE.Referer,
            Accept: "application/json",
        };
        if (this.ctx.credentials?.sessionId) {
            headers.Cookie = this.ctx.credentials.sessionSign
                ? `sessionid=${this.ctx.credentials.sessionId}; sessionid_sign=${this.ctx.credentials.sessionSign}`
                : `sessionid=${this.ctx.credentials.sessionId}`;
        }
        const resp = await this.fetch(url, { method: "GET", headers });
        if (!resp.ok) {
            throw new Error(`Private indicators fetch failed: ${resp.status} ${resp.statusText}`);
        }
        // Transform API response to PrivateIndicator format
        const data = (await resp.json());
        return data.map(item => ({
            id: item.scriptIdPart,
            version: item.version,
            name: item.scriptName,
            title: item.scriptTitle,
            modified: item.modified,
            type: item.extra?.kind || "study",
            sourceInputsCount: item.extra?.sourceInputsCount,
        }));
    }
}
//# sourceMappingURL=indicators.module.js.map