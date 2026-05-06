// Pure C->S verb framing helpers for the TradingView ~m~N~m~{json} protocol.
//
// SCOPE
//   These are framing-only helpers. They validate their argument shapes and
//   return the literal wire string `~m~<byte-len>~m~{"m":"<verb>","p":[...]}`.
//   They do NOT open a session, hold state, or perform IO. Callers run them
//   from `tradingview.ts` (transient sessions) and `chart-session-do.ts`
//   (long-lived sessions) by writing the returned string into the upstream
//   socket.
//
// WHY pure helpers
//   bead tradingview-aau expands chart-session WS coverage from ~21 of ~60
//   verbs to full coverage. Centralising every C->S frame builder here lets
//   `tradingview.ts` and `chart-session-do.ts` share one canonical wire shape
//   and one validation surface, instead of growing two parallel string-build
//   sites with subtle drift between them.
//
// COVERED VERBS
//   This module covers every C->S verb in /tmp/tv-recon/agents/01-websocket.md
//   §2 NOT already implemented inline in tradingview.ts / study-chain.ts /
//   chart-session-do.ts. The pre-existing inline verbs (`set_auth_token`,
//   `chart_create_session`, `resolve_symbol`, `create_series`,
//   `request_more_data`, `quote_create_session`, `quote_set_fields`,
//   `quote_add_symbols`, `quote_fast_symbols`, `create_study`, `modify_study`,
//   `replay_create_session`, `replay_add_series`, `replay_reset`,
//   `replay_step`, `set_locale`) are intentionally NOT re-emitted here; their
//   call sites already exist and are owned by tradingview.ts / chart-session
//   -do.ts. Adding duplicates here would invite drift, not safety.
//
// VALIDATION POLICY
//   Each helper throws synchronously on missing required args or obviously
//   wrong types. Validation is a sanity check, not a security boundary - the
//   Worker's HMAC-protected stateless routes already gate caller identity. We
//   reject empties so call sites fail loudly during dev rather than silently
//   shipping malformed frames TradingView would respond to with
//   `protocol_error`.
//
// RETURN SHAPE
//   Every helper returns the framed payload as a string. Callers pass it
//   straight to `socket.sendText(...)` or `RawWebSocket.sendText(...)`. The
//   helpers do not write anywhere themselves.
//
// PARAMS PASSING
//   Most helpers take a single `args` object (named fields) for clarity, then
//   internally lay them out in the exact positional order TradingView expects.
//   Wire-positional ordering is documented in the bead spec and re-asserted
//   in the per-verb tests so a refactor cannot silently re-order params.

import { frameTradingViewMessage } from "../../packages/tradingview-core/src";

// === Common arg shapes ====================================================

export interface ChartSessionArgs {
  /** Chart session id, e.g. "cs_<random>". */
  chartSession: string;
}

export interface ReplaySessionArgs {
  /** Replay session id, e.g. "rs_<random>". */
  replaySession: string;
}

export interface QuoteSessionArgs {
  /** Quote session id, e.g. "qs_<random>". */
  quoteSession: string;
}

const requireNonEmptyString = (value: any, fieldPath: string): string => {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${fieldPath} must be a non-empty string`);
  }
  return value;
};

const requireFiniteNumber = (value: any, fieldPath: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${fieldPath} must be a finite number`);
  }
  return value;
};

const requirePositiveInteger = (value: any, fieldPath: string): number => {
  const n = requireFiniteNumber(value, fieldPath);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`${fieldPath} must be a positive integer`);
  }
  return n;
};

// === Series management ====================================================

export interface ModifySeriesArgs extends ChartSessionArgs {
  /** Series data slot id, e.g. "sds_1". */
  seriesId: string;
  /** Source slot id (typically "s1"). */
  sourceId: string;
  /** Resolved symbol slot id (e.g. "sds_sym_1"). */
  symbolId: string;
  /** Timeframe, validated upstream. */
  timeframe: string;
  /** Bar count to request. */
  count: number;
}

/** modify_series — re-parameterize an existing series in place. */
export const modifySeries = (args: ModifySeriesArgs): string => {
  const cs = requireNonEmptyString(args.chartSession, "chartSession");
  const sdsId = requireNonEmptyString(args.seriesId, "seriesId");
  const sourceId = requireNonEmptyString(args.sourceId, "sourceId");
  const symbolId = requireNonEmptyString(args.symbolId, "symbolId");
  const tf = requireNonEmptyString(args.timeframe, "timeframe");
  const count = requirePositiveInteger(args.count, "count");
  return frameTradingViewMessage("modify_series", [cs, sdsId, sourceId, symbolId, tf, count]);
};

export interface RemoveSeriesArgs extends ChartSessionArgs {
  seriesId: string;
}

/** remove_series — drop a series slot from the chart session. */
export const removeSeries = (args: RemoveSeriesArgs): string => {
  const cs = requireNonEmptyString(args.chartSession, "chartSession");
  const sdsId = requireNonEmptyString(args.seriesId, "seriesId");
  return frameTradingViewMessage("remove_series", [cs, sdsId]);
};

export interface SeriesTimeframeArgs extends ChartSessionArgs {
  seriesId: string;
  sourceId: string;
  timeframe: string;
  /** Optional explicit window. Both must be unix-seconds when supplied. */
  range?: { from: number; to: number };
}

/** series_timeframe — intraday tf switch on an existing series. */
export const seriesTimeframe = (args: SeriesTimeframeArgs): string => {
  const cs = requireNonEmptyString(args.chartSession, "chartSession");
  const sds = requireNonEmptyString(args.seriesId, "seriesId");
  const source = requireNonEmptyString(args.sourceId, "sourceId");
  const tf = requireNonEmptyString(args.timeframe, "timeframe");
  const params: any[] = [cs, sds, source, tf];
  if (args.range !== undefined) {
    const from = requireFiniteNumber(args.range.from, "range.from");
    const to = requireFiniteNumber(args.range.to, "range.to");
    if (to < from) throw new Error("range.to must be >= range.from");
    params.push({ from, to });
  }
  return frameTradingViewMessage("series_timeframe", params);
};

// === Session-wide chart settings ==========================================

export interface SetDataQualityArgs extends ChartSessionArgs {
  quality: "low" | "high";
}

/** set_data_quality — trims plot precision and drops some nonseries blocks. */
export const setDataQuality = (args: SetDataQualityArgs): string => {
  const cs = requireNonEmptyString(args.chartSession, "chartSession");
  if (args.quality !== "low" && args.quality !== "high") {
    throw new Error('quality must be "low" or "high"');
  }
  return frameTradingViewMessage("set_data_quality", [cs, args.quality]);
};

export interface SwitchTimezoneArgs extends ChartSessionArgs {
  /** IANA timezone, e.g. "Etc/UTC", "America/New_York". */
  timezone: string;
}

/** switch_timezone — fixes session timezone for tickmark/event alignment. */
export const switchTimezone = (args: SwitchTimezoneArgs): string => {
  const cs = requireNonEmptyString(args.chartSession, "chartSession");
  const tz = requireNonEmptyString(args.timezone, "timezone");
  return frameTradingViewMessage("switch_timezone", [cs, tz]);
};

export interface SetFutureTickmarksModeArgs extends ChartSessionArgs {
  /** Server treats this as an opaque integer/string mode flag. */
  mode: number | string;
}

/** set_future_tickmarks_mode — controls whether economic events project. */
export const setFutureTickmarksMode = (args: SetFutureTickmarksModeArgs): string => {
  const cs = requireNonEmptyString(args.chartSession, "chartSession");
  if (
    (typeof args.mode !== "number" || !Number.isFinite(args.mode)) &&
    (typeof args.mode !== "string" || args.mode.length === 0)
  ) {
    throw new Error("mode must be a finite number or non-empty string");
  }
  return frameTradingViewMessage("set_future_tickmarks_mode", [cs, args.mode]);
};

// === Tickmark / metadata / problems queries ===============================

export interface RequestMoreTickmarksArgs extends ChartSessionArgs {
  /** Either a series slot ("sds_1") or a study slot ("st1"). */
  slot: string;
  count: number;
}

/** request_more_tickmarks — backfill tickmark labels (events/economic). */
export const requestMoreTickmarks = (args: RequestMoreTickmarksArgs): string => {
  const cs = requireNonEmptyString(args.chartSession, "chartSession");
  const slot = requireNonEmptyString(args.slot, "slot");
  const count = requirePositiveInteger(args.count, "count");
  return frameTradingViewMessage("request_more_tickmarks", [cs, slot, count]);
};

/** request_studies_metadata — server returns master schema for built-ins. */
export const requestStudiesMetadata = (args: ChartSessionArgs): string => {
  const cs = requireNonEmptyString(args.chartSession, "chartSession");
  return frameTradingViewMessage("request_studies_metadata", [cs]);
};

/** request_data_problems — fetch outstanding data-gap reasons. */
export const requestDataProblems = (args: ChartSessionArgs): string => {
  const cs = requireNonEmptyString(args.chartSession, "chartSession");
  return frameTradingViewMessage("request_data_problems", [cs]);
};

// === Broker / chart misc ==================================================

export interface SetBrokerArgs extends ChartSessionArgs {
  brokerId: string;
}

/** set_broker — bind a broker integration id to the chart session. */
export const setBroker = (args: SetBrokerArgs): string => {
  const cs = requireNonEmptyString(args.chartSession, "chartSession");
  const broker = requireNonEmptyString(args.brokerId, "brokerId");
  return frameTradingViewMessage("set_broker", [cs, broker]);
};

/** chart_delete_session — close a chart session cleanly. */
export const chartDeleteSession = (args: ChartSessionArgs): string => {
  const cs = requireNonEmptyString(args.chartSession, "chartSession");
  return frameTradingViewMessage("chart_delete_session", [cs]);
};

export interface GetFirstBarTimeArgs extends ChartSessionArgs {
  seriesId: string;
}

/** get_first_bar_time — probe earliest available bar timestamp. */
export const getFirstBarTime = (args: GetFirstBarTimeArgs): string => {
  const cs = requireNonEmptyString(args.chartSession, "chartSession");
  const sds = requireNonEmptyString(args.seriesId, "seriesId");
  return frameTradingViewMessage("get_first_bar_time", [cs, sds]);
};

// === Study lifecycle (extra; create_study / modify_study live elsewhere) ==

export interface RemoveStudyArgs extends ChartSessionArgs {
  studyId: string; // "st<n>"
}

/** remove_study — drop a study slot. */
export const removeStudy = (args: RemoveStudyArgs): string => {
  const cs = requireNonEmptyString(args.chartSession, "chartSession");
  const st = requireNonEmptyString(args.studyId, "studyId");
  return frameTradingViewMessage("remove_study", [cs, st]);
};

export interface NotifyStudyArgs extends ChartSessionArgs {
  studyId: string;
  /** Trailing positional payload; opaque to this layer. */
  args: any[];
}

/** notify_study — push UI-driven event into a study (e.g. drawings ack). */
export const notifyStudy = (a: NotifyStudyArgs): string => {
  const cs = requireNonEmptyString(a.chartSession, "chartSession");
  const st = requireNonEmptyString(a.studyId, "studyId");
  if (!Array.isArray(a.args)) {
    throw new Error("args must be an array");
  }
  return frameTradingViewMessage("notify_study", [cs, st, ...a.args]);
};

// === Pointsets (drawings) =================================================

export interface CreatePointsetArgs extends ChartSessionArgs {
  pointsetId: string; // "ps_<n>"
  /** Trailing positional payload; opaque to this layer. */
  args: any[];
}

/** create_pointset — register a drawing pointset. */
export const createPointset = (a: CreatePointsetArgs): string => {
  const cs = requireNonEmptyString(a.chartSession, "chartSession");
  const ps = requireNonEmptyString(a.pointsetId, "pointsetId");
  if (!Array.isArray(a.args)) throw new Error("args must be an array");
  return frameTradingViewMessage("create_pointset", [cs, ps, ...a.args]);
};

export interface ModifyPointsetArgs extends ChartSessionArgs {
  pointsetId: string;
  args: any[];
}

/** modify_pointset — update an existing pointset payload. */
export const modifyPointset = (a: ModifyPointsetArgs): string => {
  const cs = requireNonEmptyString(a.chartSession, "chartSession");
  const ps = requireNonEmptyString(a.pointsetId, "pointsetId");
  if (!Array.isArray(a.args)) throw new Error("args must be an array");
  return frameTradingViewMessage("modify_pointset", [cs, ps, ...a.args]);
};

export interface RemovePointsetArgs extends ChartSessionArgs {
  pointsetId: string;
}

/** remove_pointset — drop a drawing pointset. */
export const removePointset = (a: RemovePointsetArgs): string => {
  const cs = requireNonEmptyString(a.chartSession, "chartSession");
  const ps = requireNonEmptyString(a.pointsetId, "pointsetId");
  return frameTradingViewMessage("remove_pointset", [cs, ps]);
};

// === Replay verbs (extra; create/add_series/reset live elsewhere) =========

export interface ReplaySetResolutionArgs extends ReplaySessionArgs {
  /** Replay slot id (e.g. "rs1s"). */
  slot: string;
  timeframe: string;
}

/** replay_set_resolution — change replay tf; forces recompute. */
export const replaySetResolution = (a: ReplaySetResolutionArgs): string => {
  const rs = requireNonEmptyString(a.replaySession, "replaySession");
  const slot = requireNonEmptyString(a.slot, "slot");
  const tf = requireNonEmptyString(a.timeframe, "timeframe");
  return frameTradingViewMessage("replay_set_resolution", [rs, slot, tf]);
};

export interface ReplayGetDepthArgs extends ReplaySessionArgs {
  slot: string;
}

/** replay_get_depth — server returns max replayable bars for the slot. */
export const replayGetDepth = (a: ReplayGetDepthArgs): string => {
  const rs = requireNonEmptyString(a.replaySession, "replaySession");
  const slot = requireNonEmptyString(a.slot, "slot");
  return frameTradingViewMessage("replay_get_depth", [rs, slot]);
};

export interface ReplayRemoveSeriesArgs extends ReplaySessionArgs {
  slot: string;
}

/** replay_remove_series — drop a series from a replay session. */
export const replayRemoveSeries = (a: ReplayRemoveSeriesArgs): string => {
  const rs = requireNonEmptyString(a.replaySession, "replaySession");
  const slot = requireNonEmptyString(a.slot, "slot");
  return frameTradingViewMessage("replay_remove_series", [rs, slot]);
};

/** replay_delete_session — close a replay session. */
export const replayDeleteSession = (args: ReplaySessionArgs): string => {
  const rs = requireNonEmptyString(args.replaySession, "replaySession");
  return frameTradingViewMessage("replay_delete_session", [rs]);
};

export interface ReplayStartArgs extends ReplaySessionArgs {
  slot: string;
  /** Trailing positional args (e.g. [interval, speed]); opaque here. */
  args: any[];
}

/** replay_start — begin auto-stepping a replay slot. */
export const replayStart = (a: ReplayStartArgs): string => {
  const rs = requireNonEmptyString(a.replaySession, "replaySession");
  const slot = requireNonEmptyString(a.slot, "slot");
  if (!Array.isArray(a.args)) throw new Error("args must be an array");
  return frameTradingViewMessage("replay_start", [rs, slot, ...a.args]);
};

export interface ReplayStopArgs extends ReplaySessionArgs {
  slot: string;
}

/** replay_stop — pause auto-stepping a replay slot. */
export const replayStop = (a: ReplayStopArgs): string => {
  const rs = requireNonEmptyString(a.replaySession, "replaySession");
  const slot = requireNonEmptyString(a.slot, "slot");
  return frameTradingViewMessage("replay_stop", [rs, slot]);
};

// === Quote-session verbs ==================================================

/** quote_delete_session — close a quote session cleanly. */
export const quoteDeleteSession = (args: QuoteSessionArgs): string => {
  const qs = requireNonEmptyString(args.quoteSession, "quoteSession");
  return frameTradingViewMessage("quote_delete_session", [qs]);
};

export interface QuoteRemoveSymbolsArgs extends QuoteSessionArgs {
  symbols: string[];
}

/** quote_remove_symbols — unsubscribe symbols from a quote session. */
export const quoteRemoveSymbols = (a: QuoteRemoveSymbolsArgs): string => {
  const qs = requireNonEmptyString(a.quoteSession, "quoteSession");
  if (!Array.isArray(a.symbols) || a.symbols.length === 0) {
    throw new Error("symbols must be a non-empty array");
  }
  for (let i = 0; i < a.symbols.length; i += 1) {
    requireNonEmptyString(a.symbols[i], `symbols[${i}]`);
  }
  return frameTradingViewMessage("quote_remove_symbols", [qs, ...a.symbols]);
};

/** quote_hibernate_all — hibernate every subscription in the session. */
export const quoteHibernateAll = (args: QuoteSessionArgs): string => {
  const qs = requireNonEmptyString(args.quoteSession, "quoteSession");
  return frameTradingViewMessage("quote_hibernate_all", [qs]);
};

/** quote_list_fields — server returns the field set the session is using. */
export const quoteListFields = (args: QuoteSessionArgs): string => {
  const qs = requireNonEmptyString(args.quoteSession, "quoteSession");
  return frameTradingViewMessage("quote_list_fields", [qs]);
};
