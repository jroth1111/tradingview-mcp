// News mediator helpers (P16, bead tradingview-fn9).
//
// Mediator host (canonical, current SPA usage):
//   https://news-mediator.tradingview.com/public/news-flow/v2/news
//   https://news-mediator.tradingview.com/public/view/v1/symbol
// Headlines host (legacy + content/story JSON):
//   https://news-headlines.tradingview.com/v2/story?id=...
//
// Mediator returns a different shape than headlines (`title/storyPath/provider.{id,name,logo_id}`
// vs headlines `headline/url/source`). These helpers expose the canonical mediator
// shape without modifying the existing `worker/src/tradingview.ts` `fetchNews` (legacy
// headlines path stays for backward-compat). Story content is fetched via headlines
// `/v2/story?id=` JSON which is preferred over HTML scraping.

const MEDIATOR_HOST = "https://news-mediator.tradingview.com";
const HEADLINES_HOST = "https://news-headlines.tradingview.com";

const MEDIATOR_NEWS_FLOW_PATH = "/public/news-flow/v2/news";
const MEDIATOR_SYMBOL_VIEW_PATH = "/public/view/v1/symbol";
const HEADLINES_STORY_PATH = "/v2/story";

// Filters allowed on `/public/news-flow/v2/news` (per recon §2):
//   market: bond, crypto, economic, etf, forex, futures, index, stock
//   priority: top_stories
//   market_country: ISO2 country code (e.g. US, EU)
//   tag: e.g. overview
//   symbol: EXCHANGE:TICKER
// Filter values are colon-joined `<axis>:<value>` and comma-separated when composing.

export const NEWS_MEDIATOR_MARKETS = [
  "stock",
  "crypto",
  "forex",
  "futures",
  "economic",
  "etf",
  "bond",
  "index",
] as const;
export type NewsMediatorMarket = (typeof NEWS_MEDIATOR_MARKETS)[number];

export const NEWS_MEDIATOR_PRIORITIES = ["top_stories"] as const;
export type NewsMediatorPriority = (typeof NEWS_MEDIATOR_PRIORITIES)[number];

export const NEWS_MEDIATOR_CLIENTS = ["overview", "chart", "landing", "news_flow"] as const;
export type NewsMediatorClient = (typeof NEWS_MEDIATOR_CLIENTS)[number];

export interface NewsProvider {
  id?: string;
  name?: string;
  logoId?: string;
}

export interface MediatorNewsItem {
  id: string;
  title: string;
  published: number;
  urgency?: number;
  storyPath?: string;
  provider: NewsProvider;
  relatedSymbols: string[];
  permission?: string;
  isFlash?: boolean;
}

export interface MediatorNewsResponse {
  items: MediatorNewsItem[];
  cursor?: string;
  streamingChannel?: string;
}

export interface MediatorSymbolViewSection {
  id?: string;
  title?: string;
  items: MediatorNewsItem[];
}

export interface MediatorSymbolViewResponse {
  sections: MediatorSymbolViewSection[];
  items: MediatorNewsItem[];
}

export interface SymbolNewsRequest {
  symbol: string; // EXCHANGE:TICKER, e.g. NASDAQ:AAPL
  lang?: string;
  client?: NewsMediatorClient | string;
  streaming?: boolean;
  cursor?: string;
}

export interface CategoryNewsRequest {
  market?: NewsMediatorMarket | string;
  country?: string;
  tag?: string;
  priority?: NewsMediatorPriority | string;
  symbol?: string;
  lang?: string;
  client?: NewsMediatorClient | string;
  streaming?: boolean;
  cursor?: string;
}

export interface SymbolViewRequest {
  symbol: string;
  lang?: string;
  client?: NewsMediatorClient | string;
}

export interface StoryRequest {
  id: string;
  lang?: string;
}

export interface StoryJson {
  id?: string;
  title?: string;
  shortDescription?: string;
  body?: string;
  published?: number | string;
  source?: string;
  storyPath?: string;
  raw?: any;
}

const upstreamFailure = (route: string, resp: Response): Error => {
  const err = new Error(`${route} failed: ${resp.status} ${resp.statusText}`);
  (err as any).status = resp.status;
  (err as any).statusText = resp.statusText;
  return err;
};

const composeFilter = (parts: Array<[string, string | undefined]>): string =>
  parts
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([axis, value]) => `${axis}:${value}`)
    .join(",");

const buildMediatorUrl = (
  path: string,
  params: {
    filter?: string;
    lang?: string;
    client?: string;
    streaming?: boolean;
    cursor?: string;
  },
): URL => {
  const url = new URL(`${MEDIATOR_HOST}${path}`);
  // Mediator requires `filter=lang:en` baseline; when a feature filter is set,
  // join it with `,lang:<lang>` so the upstream parses both axes.
  const lang = params.lang || "en";
  const featureFilter = params.filter && params.filter.length ? params.filter : "";
  const composed = featureFilter ? `${featureFilter},lang:${lang}` : `lang:${lang}`;
  url.searchParams.set("filter", composed);
  if (params.client) url.searchParams.set("client", params.client);
  if (params.streaming) url.searchParams.set("streaming", "true");
  if (params.cursor) url.searchParams.set("cursor", params.cursor);
  return url;
};

const normalizeProvider = (provider: any): NewsProvider => {
  if (!provider || typeof provider !== "object") return {};
  return {
    id: provider.id,
    name: provider.name,
    // Mediator returns logo_id (snake_case); expose camelCase to callers.
    logoId: provider.logoId ?? provider.logo_id,
  };
};

const normalizeRelatedSymbols = (raw: any): string[] => {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      if (typeof entry === "string") return entry;
      if (entry && typeof entry === "object") {
        return entry.symbol || entry.id || "";
      }
      return "";
    })
    .filter((symbol) => typeof symbol === "string" && symbol.length > 0);
};

const normalizeItem = (item: any): MediatorNewsItem => ({
  id: String(item?.id ?? ""),
  title: String(item?.title ?? ""),
  published: Number(item?.published ?? 0),
  urgency: typeof item?.urgency === "number" ? item.urgency : undefined,
  storyPath: item?.storyPath ?? item?.story_path ?? undefined,
  provider: normalizeProvider(item?.provider ?? item?.source),
  relatedSymbols: normalizeRelatedSymbols(item?.relatedSymbols ?? item?.related_symbols),
  permission: item?.permission,
  isFlash: typeof item?.isFlash === "boolean" ? item.isFlash : Boolean(item?.is_flash),
});

const normalizeMediatorResponse = (data: any): MediatorNewsResponse => {
  const rawItems = Array.isArray(data?.items) ? data.items : [];
  return {
    items: rawItems.map(normalizeItem),
    cursor: data?.pagination?.cursor ?? data?.cursor ?? undefined,
    streamingChannel: data?.streaming?.channel ?? data?.streamingChannel ?? undefined,
  };
};

const normalizeSymbolViewResponse = (data: any): MediatorSymbolViewResponse => {
  const sectionsRaw = Array.isArray(data?.sections) ? data.sections : [];
  const sections: MediatorSymbolViewSection[] = sectionsRaw.map((section: any) => ({
    id: section?.id ?? section?.name,
    title: section?.title,
    items: Array.isArray(section?.items) ? section.items.map(normalizeItem) : [],
  }));
  const flat: MediatorNewsItem[] = Array.isArray(data?.items) ? data.items.map(normalizeItem) : [];
  return { sections, items: flat };
};

// === Symbol-anchored news (mediator) ===
export const getSymbolNews = async (
  req: SymbolNewsRequest,
): Promise<MediatorNewsResponse> => {
  if (!req.symbol) throw new Error("symbol required");
  const url = buildMediatorUrl(MEDIATOR_NEWS_FLOW_PATH, {
    filter: `symbol:${req.symbol}`,
    lang: req.lang,
    client: req.client ?? "chart",
    streaming: req.streaming,
    cursor: req.cursor,
  });
  const resp = await fetch(url.toString());
  if (!resp.ok) throw upstreamFailure("news mediator symbol fetch", resp);
  const data = (await resp.json()) as any;
  return normalizeMediatorResponse(data);
};

// === Symbol-page sectioned view (mediator) ===
//   press_release / financial_statement / insider / esg / recommendation
export const getSymbolNewsView = async (
  req: SymbolViewRequest,
): Promise<MediatorSymbolViewResponse> => {
  if (!req.symbol) throw new Error("symbol required");
  const url = buildMediatorUrl(MEDIATOR_SYMBOL_VIEW_PATH, {
    filter: `symbol:${req.symbol}`,
    lang: req.lang,
    client: req.client ?? "overview",
  });
  const resp = await fetch(url.toString());
  if (!resp.ok) throw upstreamFailure("news mediator symbol-view fetch", resp);
  const data = (await resp.json()) as any;
  return normalizeSymbolViewResponse(data);
};

// === Category / market / country / priority feed (mediator) ===
// Compose any subset of axes — at least one of {market, priority, symbol} is required.
export const getCategoryNews = async (
  req: CategoryNewsRequest,
): Promise<MediatorNewsResponse> => {
  const filter = composeFilter([
    ["market", req.market],
    ["market_country", req.country],
    ["tag", req.tag],
    ["priority", req.priority],
    ["symbol", req.symbol],
  ]);
  if (!filter) {
    throw new Error("at least one of market, priority, country, tag, symbol required");
  }
  const url = buildMediatorUrl(MEDIATOR_NEWS_FLOW_PATH, {
    filter,
    lang: req.lang,
    client: req.client ?? "news_flow",
    streaming: req.streaming,
    cursor: req.cursor,
  });
  const resp = await fetch(url.toString());
  if (!resp.ok) throw upstreamFailure("news mediator category fetch", resp);
  const data = (await resp.json()) as any;
  return normalizeMediatorResponse(data);
};

// === Story content JSON (headlines) ===
// Preferred over HTML scrape — `news-headlines/v2/story?id=` returns the canonical
// article JSON with shortDescription/body/published.
export const getStoryJson = async (req: StoryRequest): Promise<StoryJson> => {
  if (!req.id) throw new Error("id required");
  const url = new URL(`${HEADLINES_HOST}${HEADLINES_STORY_PATH}`);
  url.searchParams.set("id", req.id);
  url.searchParams.set("lang", req.lang || "en");
  const resp = await fetch(url.toString());
  if (!resp.ok) throw upstreamFailure("news headlines story fetch", resp);
  const data = (await resp.json()) as any;
  return {
    id: data?.id,
    title: data?.title ?? data?.headline,
    shortDescription: data?.shortDescription ?? data?.short_description,
    body: typeof data?.body === "string" ? data.body : undefined,
    published: data?.published,
    source: data?.source ?? data?.provider?.name,
    storyPath: data?.storyPath ?? data?.story_path,
    raw: data,
  };
};

// Exported for tests; callers shouldn't depend on these directly.
export const _internal = {
  buildMediatorUrl,
  composeFilter,
  normalizeItem,
  normalizeMediatorResponse,
  normalizeSymbolViewResponse,
  MEDIATOR_HOST,
  HEADLINES_HOST,
  MEDIATOR_NEWS_FLOW_PATH,
  MEDIATOR_SYMBOL_VIEW_PATH,
  HEADLINES_STORY_PATH,
};
