// Watchlists / Symbols-list CRUD (P12)
// Surface: https://www.tradingview.com (cookie-auth)
//   - GET /api/v1/symbols_list/{type}/?source=web — list all|custom|colored
//   - GET/POST/DELETE /api/v1/symbols_list/custom/{id}/ — single custom CRUD
//   - POST /api/v1/symbols_list/custom/{id}/{append|remove|replace}/ — symbol bulk ops
//     (replace also takes ?unsafe=true)
//   - POST /api/v1/symbols_list/custom/{id}/{rename|update_meta}/ — name/description
//   - POST /api/v1/symbols_list/{custom|colored}/{id}/replace_symbol/ — single swap
//   - GET /api/v1/symbols_list/active/ — currently active list
//   - POST /api/v1/symbols_list/active/{id}/ — set active list
//
// All write paths send Content-Type: application/json plus Referer:
// https://www.tradingview.com/. If the resolved cookie carries a csrftoken
// crumb (TradingView occasionally pins one for write paths), forward it as
// X-CSRFToken so the upstream Django CSRF middleware accepts the request.

const TV_WWW = "https://www.tradingview.com";
const REFERER = "https://www.tradingview.com/";

export type WatchlistType = "custom" | "colored";
export type WatchlistListType = "all" | "custom" | "colored";

export interface Watchlist {
  id: number | null;
  type: WatchlistType;
  name: string;
  symbols: string[];
  active: boolean;
  shared: boolean;
  color: string | null;
  description: string | null;
  created: string | null;
  modified: string | null;
}

export interface WatchlistContext {
  sessionId: string;
  sessionSign?: string;
  csrfToken?: string;
}

const buildCookie = (ctx: WatchlistContext): string => {
  const parts: string[] = [`sessionid=${ctx.sessionId}`];
  if (ctx.sessionSign) parts.push(`sessionid_sign=${ctx.sessionSign}`);
  if (ctx.csrfToken) parts.push(`csrftoken=${ctx.csrfToken}`);
  return parts.join(";");
};

const baseHeaders = (ctx: WatchlistContext): Record<string, string> => {
  const h: Record<string, string> = {
    cookie: buildCookie(ctx),
    referer: REFERER,
  };
  if (ctx.csrfToken) h["x-csrftoken"] = ctx.csrfToken;
  return h;
};

const writeHeaders = (ctx: WatchlistContext): Record<string, string> => ({
  ...baseHeaders(ctx),
  "content-type": "application/json",
});

const readJson = async (resp: Response, route: string): Promise<any> => {
  if (resp.status === 401 || resp.status === 403) {
    const text = await resp.text().catch(() => "");
    throw new Error(
      `${route} unauthorized: ${resp.status} ${resp.statusText}${text ? ` — ${text}` : ""}`,
    );
  }
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(
      `${route} failed: ${resp.status} ${resp.statusText}${text ? ` — ${text}` : ""}`,
    );
  }
  // Empty 204 / DELETE responses are common.
  const text = await resp.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
};

// Normalises a raw upstream record into the Watchlist shape declared above.
// Upstream sometimes omits booleans and dates on partial responses; coerce to
// the documented schema so callers (and tests) can rely on shape.
const parseWatchlist = (raw: any): Watchlist => {
  if (!raw || typeof raw !== "object") {
    return {
      id: null,
      type: "custom",
      name: "",
      symbols: [],
      active: false,
      shared: false,
      color: null,
      description: null,
      created: null,
      modified: null,
    };
  }
  const type: WatchlistType = raw.type === "colored" ? "colored" : "custom";
  return {
    id: raw.id == null ? null : Number(raw.id),
    type,
    name: typeof raw.name === "string" ? raw.name : "",
    symbols: Array.isArray(raw.symbols) ? raw.symbols.map((s: any) => String(s)) : [],
    active: Boolean(raw.active),
    shared: Boolean(raw.shared),
    color: raw.color == null ? null : String(raw.color),
    description: raw.description == null ? null : String(raw.description),
    created: raw.created == null ? null : String(raw.created),
    modified: raw.modified == null ? null : String(raw.modified),
  };
};

const parseWatchlistArray = (raw: any): Watchlist[] => {
  if (!Array.isArray(raw)) return [];
  return raw.map(parseWatchlist);
};

// ---------- 1. List all/custom/colored ----------

export const listWatchlists = async (
  ctx: WatchlistContext,
  type: WatchlistListType = "all",
): Promise<Watchlist[]> => {
  if (type !== "all" && type !== "custom" && type !== "colored") {
    throw new Error(`invalid watchlist type: ${type}`);
  }
  const url = `${TV_WWW}/api/v1/symbols_list/${type}/?source=web`;
  const resp = await fetch(url, { headers: baseHeaders(ctx) });
  const data = await readJson(resp, `GET /api/v1/symbols_list/${type}/`);
  return parseWatchlistArray(data);
};

// ---------- 2. Get single custom list ----------

export const getWatchlist = async (
  ctx: WatchlistContext,
  id: number | string,
): Promise<Watchlist> => {
  if (id === undefined || id === null || id === "") throw new Error("id required");
  const url = `${TV_WWW}/api/v1/symbols_list/custom/${encodeURIComponent(String(id))}/`;
  const resp = await fetch(url, { headers: baseHeaders(ctx) });
  const data = await readJson(resp, `GET /api/v1/symbols_list/custom/${id}/`);
  return parseWatchlist(data);
};

// ---------- 3. Create custom list ----------

export const createWatchlist = async (
  ctx: WatchlistContext,
  body: { name: string; symbols?: string[] },
): Promise<Watchlist> => {
  if (!body?.name || typeof body.name !== "string") throw new Error("name required");
  const symbols = Array.isArray(body.symbols) ? body.symbols.map((s) => String(s)) : [];
  const url = `${TV_WWW}/api/v1/symbols_list/custom/`;
  const resp = await fetch(url, {
    method: "POST",
    headers: writeHeaders(ctx),
    body: JSON.stringify({ name: body.name, symbols }),
  });
  const data = await readJson(resp, "POST /api/v1/symbols_list/custom/");
  return parseWatchlist(data);
};

// ---------- 4. Delete custom list ----------

export const deleteWatchlist = async (
  ctx: WatchlistContext,
  id: number | string,
): Promise<any> => {
  if (id === undefined || id === null || id === "") throw new Error("id required");
  const url = `${TV_WWW}/api/v1/symbols_list/custom/${encodeURIComponent(String(id))}/`;
  const resp = await fetch(url, {
    method: "DELETE",
    headers: baseHeaders(ctx),
  });
  return readJson(resp, `DELETE /api/v1/symbols_list/custom/${id}/`);
};

// Helper for plural-symbol bulk operations (append, remove, replace).
const postSymbolArray = async (
  ctx: WatchlistContext,
  id: number | string,
  action: "append" | "remove" | "replace",
  symbols: string[],
  query: string = "",
): Promise<Watchlist> => {
  if (id === undefined || id === null || id === "") throw new Error("id required");
  if (!Array.isArray(symbols)) throw new Error("symbols array required");
  const path = `/api/v1/symbols_list/custom/${encodeURIComponent(String(id))}/${action}/${query}`;
  const resp = await fetch(`${TV_WWW}${path}`, {
    method: "POST",
    headers: writeHeaders(ctx),
    body: JSON.stringify(symbols.map((s) => String(s))),
  });
  const data = await readJson(resp, `POST ${path}`);
  return parseWatchlist(data);
};

// ---------- 5. Append symbols ----------

export const appendSymbols = async (
  ctx: WatchlistContext,
  id: number | string,
  symbols: string[],
): Promise<Watchlist> => postSymbolArray(ctx, id, "append", symbols);

// ---------- 6. Remove symbols ----------

export const removeSymbols = async (
  ctx: WatchlistContext,
  id: number | string,
  symbols: string[],
): Promise<Watchlist> => postSymbolArray(ctx, id, "remove", symbols);

// ---------- 7. Replace whole symbol set (?unsafe=true) ----------

export const replaceSymbols = async (
  ctx: WatchlistContext,
  id: number | string,
  symbols: string[],
): Promise<Watchlist> => postSymbolArray(ctx, id, "replace", symbols, "?unsafe=true");

// ---------- 8. Rename a custom list ----------

export const renameWatchlist = async (
  ctx: WatchlistContext,
  id: number | string,
  name: string,
): Promise<Watchlist> => {
  if (id === undefined || id === null || id === "") throw new Error("id required");
  if (!name || typeof name !== "string") throw new Error("name required");
  const path = `/api/v1/symbols_list/custom/${encodeURIComponent(String(id))}/rename/`;
  const resp = await fetch(`${TV_WWW}${path}`, {
    method: "POST",
    headers: writeHeaders(ctx),
    body: JSON.stringify({ name }),
  });
  const data = await readJson(resp, `POST ${path}`);
  return parseWatchlist(data);
};

// ---------- 9. Update description / meta ----------

export const updateMeta = async (
  ctx: WatchlistContext,
  id: number | string,
  description: string,
): Promise<Watchlist> => {
  if (id === undefined || id === null || id === "") throw new Error("id required");
  if (typeof description !== "string") throw new Error("description must be a string");
  const path = `/api/v1/symbols_list/custom/${encodeURIComponent(String(id))}/update_meta/`;
  const resp = await fetch(`${TV_WWW}${path}`, {
    method: "POST",
    headers: writeHeaders(ctx),
    body: JSON.stringify({ description }),
  });
  const data = await readJson(resp, `POST ${path}`);
  return parseWatchlist(data);
};

// ---------- 10. Replace a single symbol (works for custom + colored) ----------

export const replaceSymbol = async (
  ctx: WatchlistContext,
  body: { type: WatchlistType; id: number | string; old: string; new: string },
): Promise<Watchlist> => {
  if (body?.type !== "custom" && body?.type !== "colored") {
    throw new Error("type must be 'custom' or 'colored'");
  }
  if (body.id === undefined || body.id === null || body.id === "") throw new Error("id required");
  if (!body.old || !body.new) throw new Error("old and new symbols required");
  const path = `/api/v1/symbols_list/${body.type}/${encodeURIComponent(String(body.id))}/replace_symbol/`;
  const resp = await fetch(`${TV_WWW}${path}`, {
    method: "POST",
    headers: writeHeaders(ctx),
    body: JSON.stringify({ old: body.old, new: body.new }),
  });
  const data = await readJson(resp, `POST ${path}`);
  return parseWatchlist(data);
};

// ---------- 11. Get currently active list ----------

export const getActiveWatchlist = async (ctx: WatchlistContext): Promise<Watchlist> => {
  const url = `${TV_WWW}/api/v1/symbols_list/active/`;
  const resp = await fetch(url, { headers: baseHeaders(ctx) });
  const data = await readJson(resp, "GET /api/v1/symbols_list/active/");
  return parseWatchlist(data);
};

// ---------- 12. Set active list ----------

export const setActiveWatchlist = async (
  ctx: WatchlistContext,
  id: number | string,
): Promise<any> => {
  if (id === undefined || id === null || id === "") throw new Error("id required");
  const path = `/api/v1/symbols_list/active/${encodeURIComponent(String(id))}/`;
  const resp = await fetch(`${TV_WWW}${path}`, {
    method: "POST",
    headers: writeHeaders(ctx),
  });
  return readJson(resp, `POST ${path}`);
};
