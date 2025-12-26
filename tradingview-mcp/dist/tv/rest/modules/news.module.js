import { BaseModule } from '../base-module.js';
import { AUTH_HEADERS_BASE } from '../utils.js';
export class NewsModule extends BaseModule {
    async getBySymbol(symbol, opts = {}) {
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
        const resp = await this.fetch(url.toString(), {
            headers: {
                Origin: AUTH_HEADERS_BASE.Origin,
                Referer: AUTH_HEADERS_BASE.Referer
            },
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
}
//# sourceMappingURL=news.module.js.map