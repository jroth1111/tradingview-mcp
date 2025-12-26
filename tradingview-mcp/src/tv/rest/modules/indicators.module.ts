import type { IndicatorMeta, IndicatorSearchResult } from '../../types.js';
import type { RestContext } from '../context.js';
import { BaseModule } from '../base-module.js';
import { AUTH_HEADERS_BASE } from '../utils.js';

export interface PrivateIndicator {
  id: string;
  version: string;
  name: string;
  title: string;
  modified: number;
  type: string;
  sourceInputsCount?: number;
}

export class IndicatorsModule extends BaseModule {
  async search(query: string): Promise<IndicatorSearchResult[]> {
    if (!query) throw new Error("query required");
    const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
    
    const builtIns: IndicatorSearchResult[] = [];
    
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
          const data = (await resp.json()) as Array<{
            scriptIdPart: string;
            version: string;
            scriptName: string;
            extra?: { shortDescription?: string; kind?: string };
          }>;
          
          const matches = data
            .filter(i => norm(i.scriptName).includes(norm(query)) ||
              norm(i.extra?.shortDescription || "").includes(norm(query)))
            .map(ind => ({
              id: ind.scriptIdPart,
              version: ind.version,
              name: ind.scriptName,
              author: { username: "@TRADINGVIEW@" },
              access: "closed_source" as "closed_source" | "open_source" | "invite_only" | "other",
              type: (ind.extra?.kind || "study") as "other" | "study" | "strategy",
            }));
          
          builtIns.push(...matches);
        }
      } catch {
        // Continue on error
      }
    }
    
    // Fetch public scripts
    const pubMatches: IndicatorSearchResult[] = [];
    try {
      const pubUrl = new URL("https://www.tradingview.com/pubscripts-suggest-json");
      pubUrl.searchParams.set("search", encodeURIComponent(query));

      const pubResp = await this.fetch(pubUrl.toString(), {
        method: "GET",
        headers: { Origin: AUTH_HEADERS_BASE.Origin, Referer: AUTH_HEADERS_BASE.Referer, Accept: "application/json" }
      });

      if (pubResp.ok) {
        const pubData = (await pubResp.json()) as { results?: Array<{
          scriptIdPart: string;
          version: string;
          scriptName: string;
          author?: { username: string };
          access?: number;
          extra?: { kind?: string };
        }> };

        if (pubData.results) {
          const accessMap = ["open_source", "closed_source", "invite_only"];
          pubMatches.push(...(pubData.results.map(ind => ({
            id: ind.scriptIdPart,
            version: ind.version,
            name: ind.scriptName,
            author: { username: ind.author?.username || "unknown" },
            access: (accessMap[(ind.access || 1) - 1] || "other") as "open_source" | "closed_source" | "invite_only" | "other",
            type: (ind.extra?.kind || "study") as "other" | "study" | "strategy",
          }))));
        }
      }
    } catch {
      // Continue on error
    }

    // Fetch private/saved scripts if authenticated
    const privateMatches: IndicatorSearchResult[] = [];
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
            access: "closed_source" as "closed_source" | "open_source" | "invite_only" | "other",
            type: (ind.type || "study") as "other" | "study" | "strategy",
          }));
        privateMatches.push(...matches);
      } catch {
        // Continue on error - user may not have private scripts
      }
    }

    return [...privateMatches, ...builtIns, ...pubMatches];
  }

  async getMeta(id: string, version: string = "last"): Promise<IndicatorMeta> {
    if (!id) throw new Error("id required");
    const indicId = id.replace(/ |%/g, "%25");
    const url = `https://pine-facade.tradingview.com/pine-facade/translate/${indicId}/${version}`;
    
    const headers: Record<string, string> = {};
    if (this.ctx.credentials?.sessionId) {
      headers.Cookie = this.ctx.credentials.sessionSign
        ? `sessionid=${this.ctx.credentials.sessionId}; sessionid_sign=${this.ctx.credentials.sessionSign}`
        : `sessionid=${this.ctx.credentials.sessionId}`;
    }
    
    const resp = await this.fetch(url, { method: "GET", headers });
    
    if (!resp.ok) {
      throw new Error(`Indicator fetch failed: ${resp.status} ${resp.statusText}`);
    }
    
    return await resp.json() as IndicatorMeta;
  }

  async getPrivate(): Promise<PrivateIndicator[]> {
    // Use the correct endpoint as verified via Chrome DevTools
    const url = "https://pine-facade.tradingview.com/pine-facade/list?filter=saved";

    const headers: Record<string, string> = {
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
    const data = (await resp.json()) as Array<{
      scriptIdPart: string;
      version: string;
      scriptName: string;
      scriptTitle: string;
      modified: number;
      scriptSource: string;
      isTVScriptBuiltIn: boolean;
      extra?: { kind?: string; sourceInputsCount?: number };
    }>;

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
