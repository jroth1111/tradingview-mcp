// www.tradingview.com REST surfaces (P20 / tradingview-lol)
// Catch-all bead for §7 must-have/should-have endpoints from
// /tmp/tv-recon/agents/10-www-api.md.
//
// Surfaces (all on www.tradingview.com, cookie-auth except where marked):
//   - GET  /api/v1/search/resolver/?q=&hl=&exchange=  (canonical resolver — preferred over /v1/search)
//   - GET  /api/v1/study-templates/standard/          (read-only standard bucket)
//   - GET  /api/v1/ideas/?symbol=&sort=&offset=&count=
//   - GET  /api/v1/get-tweet-data/?id=                (oEmbed proxy)
//   - GET  /chats/public/get/?limit=                  (public rooms)
//   - GET  /chats/get/?limit=                         (DMs — admin context only)
//   - GET  /conversation-status/?room_id=&offset=&stat_symbol=&stat_interval=&_rand=
//   - GET  /financial/fundamentals_config_v2/         (cache 24h KV)
//   - GET  /support/support-portal-problems/?language= (i18n; cache 24h KV)
//   - GET  /api/v1/brokers/trading_panel
//   - POST /api/v1/user/profile/                      (admin profile)
//
// Forbidden by spec (NOT routed): /accounts/{signin,signup,signout,recover_password,…}/*,
// /pro-plans/*, /api/v1/offers/, /market/shopconf/, /ec/{cache,etag}.
// See worker/src/index.test.ts "Forbidden surfaces" describe block.

const TV_WWW = "https://www.tradingview.com";

// 24h TTL for slow-moving config payloads. Both fundamentals_config and the
// support i18n pack revise on TradingView quarterly product releases at most.
const ONE_DAY_SECONDS = 24 * 60 * 60;

const cookieHeader = (sessionId?: string, sessionSign?: string): Record<string, string> => {
  if (!sessionId) return {};
  return {
    cookie: sessionSign
      ? `sessionid=${sessionId};sessionid_sign=${sessionSign}`
      : `sessionid=${sessionId}`,
  };
};

const baseHeaders = (sessionId?: string, sessionSign?: string): Record<string, string> => ({
  ...cookieHeader(sessionId, sessionSign),
  referer: `${TV_WWW}/`,
});

const readJson = async (resp: Response, route: string): Promise<any> => {
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`${route} failed: ${resp.status} ${resp.statusText}${text ? ` — ${text}` : ""}`);
  }
  const text = await resp.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
};

export interface WwwCallContext {
  sessionId?: string;
  sessionSign?: string;
}

// ---------- Symbol resolver (canonical) ----------

export interface ResolverHit {
  symbol: string;
  description?: string;
  type?: string;
  exchange?: string;
  prefix?: string;
  country?: string;
  currency_code?: string;
  provider_id?: string;
  // raw payload preserved so callers can read fields the schema misses.
  raw?: Record<string, any>;
}

export interface ResolveSymbolRequest {
  q: string;
  hl?: boolean;
  exchange?: string;
  type?: string;
  lang?: string;
  sessionId?: string;
  sessionSign?: string;
}

const mapResolverHit = (raw: any): ResolverHit => ({
  symbol: raw.symbol ?? raw.proSymbol ?? raw.pro_symbol ?? "",
  description: raw.description,
  type: raw.type,
  exchange: raw.exchange,
  prefix: raw.prefix,
  country: raw.country,
  currency_code: raw.currency_code,
  provider_id: raw.provider_id,
  raw,
});

export const resolveSymbol = async (req: ResolveSymbolRequest): Promise<ResolverHit[]> => {
  if (!req?.q) throw new Error("q required");
  const params = new URLSearchParams();
  params.set("q", req.q);
  // hl=1 gives <em> highlight tags around the matched substring; default off.
  if (req.hl) params.set("hl", "1");
  if (req.exchange) params.set("exchange", req.exchange);
  if (req.type) params.set("type", req.type);
  if (req.lang) params.set("lang", req.lang);
  const url = `${TV_WWW}/api/v1/search/resolver/?${params.toString()}`;
  const resp = await fetch(url, { headers: baseHeaders(req.sessionId, req.sessionSign) });
  const data = await readJson(resp, "GET /api/v1/search/resolver/");
  // Upstream returns either {symbols_remaining,symbols:[...]} or a bare array.
  const arr: any[] = Array.isArray(data?.symbols)
    ? data.symbols
    : Array.isArray(data)
    ? data
    : [];
  return arr.map(mapResolverHit);
};

export const resolveSymbolBatch = async (
  ctx: WwwCallContext,
  queries: Array<string | Omit<ResolveSymbolRequest, "sessionId" | "sessionSign">>,
): Promise<Array<{ q: string; hits?: ResolverHit[]; error?: string }>> => {
  if (!Array.isArray(queries) || queries.length === 0) {
    throw new Error("queries array required");
  }
  return Promise.all(
    queries.map(async (entry) => {
      const req: ResolveSymbolRequest =
        typeof entry === "string"
          ? { q: entry, sessionId: ctx.sessionId, sessionSign: ctx.sessionSign }
          : { ...entry, sessionId: ctx.sessionId, sessionSign: ctx.sessionSign };
      try {
        const hits = await resolveSymbol(req);
        return { q: req.q, hits };
      } catch (err: any) {
        return { q: req.q, error: err?.message || String(err) };
      }
    }),
  );
};

// ---------- Study templates: standard bucket (read-only) ----------

export const listStudyTemplatesStandard = async (ctx: WwwCallContext): Promise<any> => {
  const resp = await fetch(`${TV_WWW}/api/v1/study-templates/standard/`, {
    headers: baseHeaders(ctx.sessionId, ctx.sessionSign),
  });
  return readJson(resp, "GET /api/v1/study-templates/standard/");
};

// ---------- Ideas feed ----------

export interface IdeaCard {
  id: string | number;
  symbol?: string;
  url?: string;
  title?: string;
  description?: string;
  author?: { username?: string; followers?: number };
  likes?: number;
  comments?: number;
  date_timestamp?: number;
  raw?: Record<string, any>;
}

export interface GetIdeasFeedRequest {
  symbol?: string;
  sort?: "recent" | "popular" | string;
  offset?: number;
  count?: number;
  sessionId?: string;
  sessionSign?: string;
}

const mapIdeaCard = (raw: any): IdeaCard => ({
  id: raw.id ?? raw.idea_id ?? "",
  symbol: raw.symbol,
  url: raw.url ?? raw.idea_url,
  title: raw.title ?? raw.name,
  description: raw.description ?? raw.short_description,
  author: raw.author ?? (raw.username ? { username: raw.username } : undefined),
  likes: raw.likes_count ?? raw.likes,
  comments: raw.comments_count ?? raw.comments,
  date_timestamp: raw.date_timestamp ?? raw.created_at,
  raw,
});

export const getIdeasFeed = async (
  req: GetIdeasFeedRequest,
): Promise<{ count: number; ideas: IdeaCard[]; next_offset?: number; raw?: any }> => {
  const params = new URLSearchParams();
  if (req.symbol) params.set("symbol", req.symbol);
  if (req.sort) params.set("sort", req.sort);
  if (req.offset != null) params.set("offset", String(req.offset));
  if (req.count != null) params.set("count", String(req.count));
  const qs = params.toString();
  const url = `${TV_WWW}/api/v1/ideas/${qs ? `?${qs}` : ""}`;
  const resp = await fetch(url, { headers: baseHeaders(req.sessionId, req.sessionSign) });
  const data = await readJson(resp, "GET /api/v1/ideas/");
  const arr: any[] = Array.isArray(data?.results)
    ? data.results
    : Array.isArray(data?.ideas)
    ? data.ideas
    : Array.isArray(data)
    ? data
    : [];
  return {
    count: typeof data?.count === "number" ? data.count : arr.length,
    ideas: arr.map(mapIdeaCard),
    next_offset: typeof data?.next_offset === "number" ? data.next_offset : undefined,
    raw: data,
  };
};

// ---------- Tweet embed proxy ----------

export interface TweetData {
  id: string;
  html?: string;
  url?: string;
  author_name?: string;
  author_url?: string;
  raw?: Record<string, any>;
}

export const getTweetData = async (id: string): Promise<TweetData> => {
  if (!id) throw new Error("id required");
  const url = `${TV_WWW}/api/v1/get-tweet-data/?id=${encodeURIComponent(id)}`;
  const resp = await fetch(url);
  const data = await readJson(resp, "GET /api/v1/get-tweet-data/");
  return {
    id,
    html: data?.html,
    url: data?.url,
    author_name: data?.author_name,
    author_url: data?.author_url,
    raw: data,
  };
};

// ---------- Chats ----------

export interface ChatRoom {
  id: number | string;
  name?: string;
  description?: string;
  members_count?: number;
  online_count?: number;
  language?: string;
  raw?: Record<string, any>;
}

const mapChatRoom = (raw: any): ChatRoom => ({
  id: raw.id ?? raw.room_id ?? "",
  name: raw.name ?? raw.title,
  description: raw.description,
  members_count: raw.members_count,
  online_count: raw.online ?? raw.online_count,
  language: raw.language,
  raw,
});

export const getPublicChats = async (
  ctx: WwwCallContext,
  limit?: number,
): Promise<{ rooms: ChatRoom[]; raw?: any }> => {
  const params = new URLSearchParams();
  if (limit != null) params.set("limit", String(limit));
  const qs = params.toString();
  const url = `${TV_WWW}/chats/public/get/${qs ? `?${qs}` : ""}`;
  const resp = await fetch(url, { headers: baseHeaders(ctx.sessionId, ctx.sessionSign) });
  const data = await readJson(resp, "GET /chats/public/get/");
  const arr: any[] = Array.isArray(data?.rooms)
    ? data.rooms
    : Array.isArray(data)
    ? data
    : [];
  return { rooms: arr.map(mapChatRoom), raw: data };
};

// /chats/get/ returns a logged-in user's DM list. Admin context only — Worker
// callers must hold the admin session. Helper requires sessionId.
export const getDmChats = async (
  ctx: WwwCallContext,
  limit?: number,
): Promise<{ rooms: ChatRoom[]; raw?: any }> => {
  if (!ctx.sessionId) throw new Error("sessionId required (DM list is admin-only)");
  const params = new URLSearchParams();
  if (limit != null) params.set("limit", String(limit));
  const qs = params.toString();
  const url = `${TV_WWW}/chats/get/${qs ? `?${qs}` : ""}`;
  const resp = await fetch(url, { headers: baseHeaders(ctx.sessionId, ctx.sessionSign) });
  const data = await readJson(resp, "GET /chats/get/");
  const arr: any[] = Array.isArray(data?.rooms)
    ? data.rooms
    : Array.isArray(data)
    ? data
    : [];
  return { rooms: arr.map(mapChatRoom), raw: data };
};

// ---------- Conversation status (live presence) ----------

export interface ConversationStatus {
  room_id: string | number;
  online?: number;
  members?: number;
  symbol_quote?: any;
  raw?: Record<string, any>;
}

export interface GetConversationStatusRequest {
  room_id: string | number;
  offset?: number;
  stat_symbol?: string;
  stat_interval?: string;
  sessionId?: string;
  sessionSign?: string;
}

export const getConversationStatus = async (
  req: GetConversationStatusRequest,
): Promise<ConversationStatus> => {
  if (req?.room_id == null || req.room_id === "") throw new Error("room_id required");
  const params = new URLSearchParams();
  params.set("room_id", String(req.room_id));
  if (req.offset != null) params.set("offset", String(req.offset));
  if (req.stat_symbol) params.set("stat_symbol", req.stat_symbol);
  if (req.stat_interval) params.set("stat_interval", req.stat_interval);
  // _rand is a cache-buster the upstream UI sends; mirror it so CDNs do not
  // serve a stale presence count.
  params.set("_rand", String(Math.random()));
  const url = `${TV_WWW}/conversation-status/?${params.toString()}`;
  const resp = await fetch(url, { headers: baseHeaders(req.sessionId, req.sessionSign) });
  const data = await readJson(resp, "GET /conversation-status/");
  return {
    room_id: req.room_id,
    online: data?.online,
    members: data?.members,
    symbol_quote: data?.symbol_quote,
    raw: data,
  };
};

// ---------- Fundamentals config (24h KV cache) ----------

export interface FundamentalsConfig {
  groups?: Array<{ id: string; name?: string; fields?: any[] }>;
  raw?: any;
}

export interface GetFundamentalsConfigRequest {
  cache?: KVNamespace;
  cacheTtlSeconds?: number;
  forceRefresh?: boolean;
}

const FUNDAMENTALS_CONFIG_KEY = "www-api:fundamentals-config-v2";

export const getFundamentalsConfig = async (
  req: GetFundamentalsConfigRequest = {},
): Promise<{ config: FundamentalsConfig; cached: boolean }> => {
  const ttl = req.cacheTtlSeconds ?? ONE_DAY_SECONDS;
  if (req.cache && !req.forceRefresh) {
    const raw = await req.cache.get(FUNDAMENTALS_CONFIG_KEY);
    if (raw) {
      try {
        return { config: JSON.parse(raw), cached: true };
      } catch {
        // poisoned cache entry; fall through and refetch.
      }
    }
  }
  const resp = await fetch(`${TV_WWW}/financial/fundamentals_config_v2/`);
  const data = await readJson(resp, "GET /financial/fundamentals_config_v2/");
  const config: FundamentalsConfig = {
    groups: Array.isArray(data?.groups) ? data.groups : undefined,
    raw: data,
  };
  if (req.cache) {
    await req.cache.put(FUNDAMENTALS_CONFIG_KEY, JSON.stringify(config), {
      expirationTtl: ttl,
    });
  }
  return { config, cached: false };
};

// ---------- Support i18n string pack (24h KV cache) ----------

export interface SupportI18nPack {
  language: string;
  problems?: any[];
  raw?: any;
}

export interface GetSupportI18nRequest {
  language?: string;
  cache?: KVNamespace;
  cacheTtlSeconds?: number;
  forceRefresh?: boolean;
}

export const getSupportI18n = async (
  req: GetSupportI18nRequest = {},
): Promise<{ pack: SupportI18nPack; cached: boolean }> => {
  const lang = req.language || "en";
  const ttl = req.cacheTtlSeconds ?? ONE_DAY_SECONDS;
  const key = `www-api:support-i18n:${lang}`;
  if (req.cache && !req.forceRefresh) {
    const raw = await req.cache.get(key);
    if (raw) {
      try {
        return { pack: JSON.parse(raw), cached: true };
      } catch {
        // poisoned cache entry; fall through.
      }
    }
  }
  const url = `${TV_WWW}/support/support-portal-problems/?language=${encodeURIComponent(lang)}`;
  const resp = await fetch(url);
  const data = await readJson(resp, "GET /support/support-portal-problems/");
  const pack: SupportI18nPack = {
    language: lang,
    problems: Array.isArray(data?.problems)
      ? data.problems
      : Array.isArray(data)
      ? data
      : undefined,
    raw: data,
  };
  if (req.cache) {
    await req.cache.put(key, JSON.stringify(pack), { expirationTtl: ttl });
  }
  return { pack, cached: false };
};

// ---------- Broker integrations panel ----------

export interface BrokerPanel {
  brokers?: Array<{ id?: string; name?: string; logo?: string; url?: string }>;
  raw?: any;
}

export const getBrokerPanel = async (ctx: WwwCallContext = {}): Promise<BrokerPanel> => {
  const resp = await fetch(`${TV_WWW}/api/v1/brokers/trading_panel`, {
    headers: baseHeaders(ctx.sessionId, ctx.sessionSign),
  });
  const data = await readJson(resp, "GET /api/v1/brokers/trading_panel");
  return {
    brokers: Array.isArray(data?.brokers)
      ? data.brokers
      : Array.isArray(data)
      ? data
      : undefined,
    raw: data,
  };
};

// ---------- User profile (admin only) ----------

export interface UserProfile {
  id?: number | string;
  username?: string;
  email?: string;
  // upstream returns a wide field set; preserve raw for callers that need it.
  raw?: Record<string, any>;
}

export interface UpdateUserProfileRequest {
  ctx: WwwCallContext;
  // Upstream accepts a multipart form; helper takes a plain object the caller
  // controls, FormData-encodes it, and forwards. Caller is responsible for
  // sending only fields they intend to change.
  fields: Record<string, string | Blob>;
}

export const getUserProfile = async (ctx: WwwCallContext): Promise<UserProfile> => {
  if (!ctx.sessionId) throw new Error("sessionId required (admin profile)");
  const resp = await fetch(`${TV_WWW}/api/v1/user/profile/`, {
    headers: baseHeaders(ctx.sessionId, ctx.sessionSign),
  });
  const data = await readJson(resp, "GET /api/v1/user/profile/");
  return {
    id: data?.id,
    username: data?.username,
    email: data?.email,
    raw: data,
  };
};

export const updateUserProfile = async (
  req: UpdateUserProfileRequest,
): Promise<UserProfile> => {
  if (!req?.ctx?.sessionId) throw new Error("sessionId required (admin profile)");
  if (!req.fields || typeof req.fields !== "object") {
    throw new Error("fields object required");
  }
  const form = new FormData();
  for (const [k, v] of Object.entries(req.fields)) {
    form.set(k, v as any);
  }
  const resp = await fetch(`${TV_WWW}/api/v1/user/profile/`, {
    method: "POST",
    headers: baseHeaders(req.ctx.sessionId, req.ctx.sessionSign),
    body: form,
  });
  const data = await readJson(resp, "POST /api/v1/user/profile/");
  return {
    id: data?.id,
    username: data?.username,
    email: data?.email,
    raw: data,
  };
};
