// Economic calendar + IPO/splits helpers (P16, bead tradingview-fn9).
//
// Three upstreams:
// 1. economic-calendar.tradingview.com/events — REQUIRES `Origin: https://www.tradingview.com`
//    header injection. Anonymous requests without Origin return 403. Returns
//    `{status:'ok', result:[{id,title,country,indicator,ticker,...}]}`.
// 2. scanner.tradingview.com/global/scan?label-product=calendar-ipo — IPO calendar via
//    the same scanner pattern used by `getDividendCalendar`/`getEarningsCalendar` in
//    `worker/src/tradingview.ts` (do not modify that file in this bead).
// 3. scanner.tradingview.com/global/scan?label-product=calendar-splits — splits via
//    `last_split_date`/`split_factor` columns.

const ECONOMIC_CALENDAR_URL = "https://economic-calendar.tradingview.com/events";
const SCANNER_GLOBAL_SCAN = "https://scanner.tradingview.com/global/scan";
const TRADINGVIEW_ORIGIN = "https://www.tradingview.com";

// === Schemas ===

export interface EconomicEvent {
  id: string;
  title: string;
  country: string;
  indicator?: string;
  ticker?: string; // e.g. ECONOMICS:USMAPL
  comment?: string;
  period?: string;
  actual?: number | string | null;
  forecast?: number | string | null;
  previous?: number | string | null;
  importance?: number;
  date: string; // ISO Z
  unit?: string;
  scale?: string;
  currency?: string;
  source?: string;
}

export interface IpoEvent {
  symbol: string;
  name?: string;
  description?: string;
  market?: string;
  country?: string;
  ipoOfferDate?: number;
  ipoOfferPriceMin?: number;
  ipoOfferPriceMax?: number;
  ipoOfferPriceCurrency?: string;
  ipoExchange?: string;
  marketCapBasic?: number;
  raw?: Record<string, any>;
}

export interface SplitEvent {
  symbol: string;
  name?: string;
  description?: string;
  market?: string;
  country?: string;
  lastSplitDate?: number;
  splitFactor?: number;
  splitFactorRatio?: string;
  raw?: Record<string, any>;
}

export interface EconomicEventsRequest {
  from?: string; // ISO timestamp
  to?: string; // ISO timestamp
  countries?: string[]; // ISO2, e.g. ["US","EU"]
  minImportance?: number; // client-side filter (importance >= n)
}

export interface IposCalendarRequest {
  from?: number; // unix seconds
  to?: number;
  countries?: string[];
  markets?: string[];
  fields?: string[];
}

export interface SplitsCalendarRequest {
  from?: number;
  to?: number;
  markets?: string[];
  fields?: string[];
}

// === Default scanner field sets ===

export const IPO_DEFAULT_FIELDS = [
  "name",
  "description",
  "logoid",
  "ipo_offer_date",
  "ipo_offer_price_min",
  "ipo_offer_price_max",
  "ipo_offer_price_currency",
  "ipo_exchange",
  "fundamental_currency_code",
  "market",
  "market_cap_basic",
  "country",
] as const;

export const SPLITS_DEFAULT_FIELDS = [
  "name",
  "description",
  "logoid",
  "last_split_date",
  "split_factor",
  "split_factor_ratio",
  "market",
  "country",
] as const;

// === Internal helpers ===

const upstreamFailure = (route: string, resp: Response): Error => {
  const err = new Error(`${route} failed: ${resp.status} ${resp.statusText}`);
  (err as any).status = resp.status;
  (err as any).statusText = resp.statusText;
  return err;
};

const isoToZ = (input?: string): string | undefined => {
  if (!input) return undefined;
  // Accept either an ISO string or unix seconds; normalize to ISO Z.
  if (/^\d+$/.test(input)) {
    return new Date(Number(input) * 1000).toISOString();
  }
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
};

const normalizeEconomicEvent = (entry: any): EconomicEvent => ({
  id: String(entry?.id ?? ""),
  title: String(entry?.title ?? ""),
  country: String(entry?.country ?? ""),
  indicator: entry?.indicator,
  ticker: entry?.ticker,
  comment: entry?.comment,
  period: entry?.period,
  actual: entry?.actual ?? null,
  forecast: entry?.forecast ?? null,
  previous: entry?.previous ?? null,
  importance: typeof entry?.importance === "number" ? entry.importance : undefined,
  date: String(entry?.date ?? ""),
  unit: entry?.unit,
  scale: entry?.scale,
  currency: entry?.currency,
  source: entry?.source,
});

interface ScannerScanRequest {
  labelProduct: "calendar-ipo" | "calendar-splits";
  columns: readonly string[] | string[];
  filter: any[];
  markets?: string[];
  range?: [number, number];
  sortField?: string;
  sortOrder?: "asc" | "desc";
}

const runScannerScan = async (req: ScannerScanRequest): Promise<any[]> => {
  const url = `${SCANNER_GLOBAL_SCAN}?label-product=${req.labelProduct}`;
  const payload: any = {
    columns: Array.from(req.columns),
    filter: req.filter,
    ignore_unknown_fields: false,
    options: { lang: "en" },
  };
  if (req.markets && req.markets.length) payload.markets = req.markets;
  if (req.range) payload.range = req.range;
  if (req.sortField) {
    payload.sort = { sortBy: req.sortField, sortOrder: req.sortOrder ?? "asc" };
  }
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) throw upstreamFailure(`scanner ${req.labelProduct}`, resp);
  const data = (await resp.json()) as any;
  return Array.isArray(data?.data) ? data.data : [];
};

// === Economic events (Origin-injected) ===

export const getEconomicEvents = async (
  req: EconomicEventsRequest = {},
): Promise<{ events: EconomicEvent[] }> => {
  const url = new URL(ECONOMIC_CALENDAR_URL);

  const now = Date.now();
  const from = isoToZ(req.from) ?? new Date(now - 7 * 86400 * 1000).toISOString();
  const to = isoToZ(req.to) ?? new Date(now + 7 * 86400 * 1000).toISOString();

  url.searchParams.set("from", from);
  url.searchParams.set("to", to);
  if (req.countries && req.countries.length) {
    url.searchParams.set("countries", req.countries.join(","));
  }

  // Origin injection is REQUIRED — anon requests without Origin return 403.
  const resp = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Origin: TRADINGVIEW_ORIGIN,
      Accept: "application/json",
    },
  });
  if (!resp.ok) throw upstreamFailure("economic calendar fetch", resp);
  const data = (await resp.json()) as any;
  if (data?.status !== "ok") {
    const err = new Error(`economic calendar status not ok: ${data?.status ?? "missing"}`);
    (err as any).envelope = data;
    throw err;
  }

  const result: any[] = Array.isArray(data?.result) ? data.result : [];
  let events = result.map(normalizeEconomicEvent);
  // Importance is filtered client-side per recon §4.
  if (typeof req.minImportance === "number") {
    events = events.filter(
      (event) => typeof event.importance === "number" && event.importance >= req.minImportance!,
    );
  }
  return { events };
};

// === IPOs calendar (scanner) ===

const buildScannerRange = (
  from: number | undefined,
  to: number | undefined,
  fallbackDays: number,
): [number, number] => {
  const now = Math.floor(Date.now() / 1000);
  const fromTs = typeof from === "number" ? from : now - fallbackDays * 86400;
  const toTs = typeof to === "number" ? to : now + fallbackDays * 86400 + 86399;
  return [fromTs, toTs];
};

export const getIposCalendar = async (
  req: IposCalendarRequest = {},
): Promise<{ events: IpoEvent[] }> => {
  const fields =
    req.fields && req.fields.length ? req.fields : (IPO_DEFAULT_FIELDS as readonly string[]);
  const [from, to] = buildScannerRange(req.from, req.to, 30);

  const filter: any[] = [
    {
      left: "ipo_offer_date",
      operation: "in_range",
      right: [from, to],
    },
  ];
  if (req.countries && req.countries.length) {
    filter.push({ left: "country", operation: "in_range", right: req.countries });
  }

  const rows = await runScannerScan({
    labelProduct: "calendar-ipo",
    columns: fields,
    filter,
    markets: req.markets,
    sortField: "ipo_offer_date",
    sortOrder: "asc",
  });

  const events: IpoEvent[] = rows.map((row: any) => {
    const symbol = row?.s ?? "";
    const vals: any[] = Array.isArray(row?.d) ? row.d : [];
    const raw: Record<string, any> = { symbol };
    fields.forEach((field, idx) => {
      raw[field] = vals[idx];
    });
    return {
      symbol,
      name: raw.name,
      description: raw.description,
      market: raw.market,
      country: raw.country,
      ipoOfferDate: typeof raw.ipo_offer_date === "number" ? raw.ipo_offer_date : undefined,
      ipoOfferPriceMin:
        typeof raw.ipo_offer_price_min === "number" ? raw.ipo_offer_price_min : undefined,
      ipoOfferPriceMax:
        typeof raw.ipo_offer_price_max === "number" ? raw.ipo_offer_price_max : undefined,
      ipoOfferPriceCurrency: raw.ipo_offer_price_currency,
      ipoExchange: raw.ipo_exchange,
      marketCapBasic:
        typeof raw.market_cap_basic === "number" ? raw.market_cap_basic : undefined,
      raw,
    };
  });
  return { events };
};

// === Splits calendar (scanner) ===

export const getSplitsCalendar = async (
  req: SplitsCalendarRequest = {},
): Promise<{ events: SplitEvent[] }> => {
  const fields =
    req.fields && req.fields.length ? req.fields : (SPLITS_DEFAULT_FIELDS as readonly string[]);
  const [from, to] = buildScannerRange(req.from, req.to, 30);

  const filter: any[] = [
    {
      left: "last_split_date",
      operation: "in_range",
      right: [from, to],
    },
  ];

  const rows = await runScannerScan({
    labelProduct: "calendar-splits",
    columns: fields,
    filter,
    markets: req.markets,
    sortField: "last_split_date",
    sortOrder: "asc",
  });

  const events: SplitEvent[] = rows.map((row: any) => {
    const symbol = row?.s ?? "";
    const vals: any[] = Array.isArray(row?.d) ? row.d : [];
    const raw: Record<string, any> = { symbol };
    fields.forEach((field, idx) => {
      raw[field] = vals[idx];
    });
    return {
      symbol,
      name: raw.name,
      description: raw.description,
      market: raw.market,
      country: raw.country,
      lastSplitDate:
        typeof raw.last_split_date === "number" ? raw.last_split_date : undefined,
      splitFactor: typeof raw.split_factor === "number" ? raw.split_factor : undefined,
      splitFactorRatio: raw.split_factor_ratio,
      raw,
    };
  });
  return { events };
};

// === Constants for reuse / testing ===

export const _internal = {
  ECONOMIC_CALENDAR_URL,
  SCANNER_GLOBAL_SCAN,
  TRADINGVIEW_ORIGIN,
  isoToZ,
  buildScannerRange,
};
