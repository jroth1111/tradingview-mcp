// Pubscripts library + built-in catalog (P4 + P5)
// Source surfaces:
//   - https://www.tradingview.com/pubscripts-library/      (browse)
//   - https://www.tradingview.com/pubscripts-library/editors-picks/
//   - https://www.tradingview.com/pubscripts-get/          (resolve by id)
//   - https://www.tradingview.com/pubscripts-get/personal-access/
//   - https://www.tradingview.com/pubscripts-suggest-json/ (typeahead)
//   - https://www.tradingview.com/api/v1/script_packages/store/
//   - https://pine-facade.tradingview.com/pine-facade/list?filter={standard,candlestick,fundamental,saved}

const PINE_FACADE = "https://pine-facade.tradingview.com";
const TV_WWW = "https://www.tradingview.com";

const cookieHeader = (sessionId?: string, sessionSign?: string): Record<string, string> => {
  if (!sessionId) return {};
  return {
    cookie: sessionSign
      ? `sessionid=${sessionId};sessionid_sign=${sessionSign}`
      : `sessionid=${sessionId}`,
  };
};

// ---------- P4: built-in catalog ----------

const BUILTIN_FILTERS = ["standard", "candlestick", "fundamental"] as const;
type BuiltinFilter = (typeof BUILTIN_FILTERS)[number] | "saved";

export interface BuiltinIndicator {
  id: string;
  version: string;
  name: string;
  kind: "study" | "strategy" | "library" | "other";
  shortDescription?: string;
  filter: BuiltinFilter;
  fundamentalCategory?: string;
}

export interface BuiltinCatalogRequest {
  filter?: BuiltinFilter | "all";
  kind?: "study" | "strategy" | "library";
  q?: string;
  fundamentalCategory?: string;
  sessionId?: string;
  sessionSign?: string;
  cache?: KVNamespace;
  cacheTtlSeconds?: number;
}

const fetchBuiltinFilter = async (
  filter: BuiltinFilter,
  sessionId?: string,
  sessionSign?: string,
): Promise<BuiltinIndicator[]> => {
  const url = `${PINE_FACADE}/pine-facade/list?filter=${encodeURIComponent(filter)}`;
  const resp = await fetch(url, { headers: cookieHeader(sessionId, sessionSign) });
  if (!resp.ok) {
    if (filter === "saved" && (resp.status === 401 || resp.status === 403)) return [];
    throw new Error(`pine-facade list ${filter} failed: ${resp.status} ${resp.statusText}`);
  }
  const data: any = await resp.json();
  if (!Array.isArray(data)) return [];
  return data.map((ind: any) => ({
    id: ind.scriptIdPart,
    version: String(ind.version ?? ""),
    name: ind.scriptName,
    kind: (ind.extra?.kind as any) || "study",
    shortDescription: ind.extra?.shortDescription,
    filter,
    fundamentalCategory: ind.extra?.fundamentalCategory,
  }));
};

export const getBuiltinCatalog = async (
  req: BuiltinCatalogRequest,
): Promise<{ count: number; results: BuiltinIndicator[]; cached: boolean }> => {
  const includeSaved = req.filter === "saved";
  const filters: BuiltinFilter[] = req.filter && req.filter !== "all"
    ? [req.filter]
    : [...BUILTIN_FILTERS];
  if (includeSaved && !filters.includes("saved")) filters.push("saved");

  const cacheKey =
    req.cache && filters.every((f) => f !== "saved")
      ? `builtin-catalog:${filters.sort().join(",")}`
      : null;

  let cachedAll: BuiltinIndicator[] | null = null;
  let fromCache = false;
  if (cacheKey && req.cache) {
    const raw = await req.cache.get(cacheKey);
    if (raw) {
      try {
        cachedAll = JSON.parse(raw);
        fromCache = true;
      } catch {
        cachedAll = null;
      }
    }
  }

  if (!cachedAll) {
    const buckets = await Promise.all(
      filters.map((f) => fetchBuiltinFilter(f, req.sessionId, req.sessionSign)),
    );
    cachedAll = buckets.flat();
    if (cacheKey && req.cache) {
      await req.cache.put(cacheKey, JSON.stringify(cachedAll), {
        expirationTtl: req.cacheTtlSeconds ?? 3600,
      });
    }
  }

  const norm = (s: string) => s.toLowerCase();
  const q = req.q ? norm(req.q) : null;
  const filtered = cachedAll.filter((ind) => {
    if (req.kind && ind.kind !== req.kind) return false;
    if (req.fundamentalCategory && ind.fundamentalCategory !== req.fundamentalCategory) {
      return false;
    }
    if (q) {
      return (
        norm(ind.name).includes(q) || norm(ind.shortDescription || "").includes(q)
      );
    }
    return true;
  });

  return { count: filtered.length, results: filtered, cached: fromCache };
};

// ---------- P5: pubscripts library ----------

export interface PubLibraryRequest {
  offset?: number;
  count?: number;
  sort?: "top" | "new" | "best_score" | string;
  isPaid?: boolean;
  type?: string;
}

export const getPubLibrary = async (req: PubLibraryRequest): Promise<any> => {
  const params = new URLSearchParams();
  params.set("offset", String(req.offset ?? 0));
  params.set("count", String(req.count ?? 20));
  if (req.sort) params.set("sort", req.sort);
  if (req.isPaid != null) params.set("is_paid", String(req.isPaid));
  if (req.type) params.set("type", req.type);
  const url = `${TV_WWW}/pubscripts-library/?${params.toString()}`;
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`pubscripts-library failed: ${resp.status} ${resp.statusText}`);
  }
  return resp.json();
};

export const getPubEditorsPicks = async (type?: string): Promise<any> => {
  const params = new URLSearchParams();
  if (type) params.set("type", type);
  const qs = params.toString();
  const url = `${TV_WWW}/pubscripts-library/editors-picks/${qs ? `?${qs}` : ""}`;
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`pubscripts-library editors-picks failed: ${resp.status} ${resp.statusText}`);
  }
  return resp.json();
};

export const getPubBatch = async (
  scriptIdPart: string,
  showHidden?: boolean,
): Promise<any> => {
  if (!scriptIdPart) throw new Error("scriptIdPart required");
  const body = new URLSearchParams();
  body.set("scriptIdPart", scriptIdPart);
  body.set("show_hidden", showHidden ? "true" : "false");
  const resp = await fetch(`${TV_WWW}/pubscripts-get/`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!resp.ok) {
    throw new Error(`pubscripts-get failed: ${resp.status} ${resp.statusText}`);
  }
  return resp.json();
};

export const getPubSuggest = async (search: string): Promise<any> => {
  if (!search) throw new Error("search required");
  const url = `${TV_WWW}/pubscripts-suggest-json/?search=${encodeURIComponent(search)}`;
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`pubscripts-suggest failed: ${resp.status} ${resp.statusText}`);
  }
  return resp.json();
};

export const getPubPersonalAccess = async (
  sessionId: string,
  sessionSign?: string,
): Promise<any> => {
  if (!sessionId) throw new Error("sessionId required");
  const resp = await fetch(`${TV_WWW}/pubscripts-get/personal-access/`, {
    headers: cookieHeader(sessionId, sessionSign),
  });
  if (!resp.ok) {
    throw new Error(`pubscripts personal-access failed: ${resp.status} ${resp.statusText}`);
  }
  return resp.json();
};

export const getScriptPackagesStore = async (
  sessionId?: string,
  sessionSign?: string,
): Promise<any> => {
  const resp = await fetch(`${TV_WWW}/api/v1/script_packages/store/`, {
    headers: cookieHeader(sessionId, sessionSign),
  });
  if (!resp.ok) {
    throw new Error(`script_packages store failed: ${resp.status} ${resp.statusText}`);
  }
  return resp.json();
};
