// Pure S->C event decoders for the TradingView ~m~ frame protocol.
//
// SCOPE
//   These decoders take a single inbound parsed frame `{ m: <verb>, p: any[] }`
//   (the shape returned by `parseMessage` in tradingview.ts /
//   chart-session-do.ts after stripping ~m~N~m~ envelopes) and return a typed
//   discriminated `WSEvent` for every interesting verb the chart-session WS
//   surface emits. They do NOT read sockets or hold state.
//
// WHY
//   bead tradingview-aau adds visibility for inbound verbs the Worker did not
//   previously decode (`study_loading`, `tickmark_update`, `index_update`,
//   `clear_data`, `studies_metadata`, `protocol_error`, `protocol_switched`,
//   `critical_error`, `replay_data_end`, `replay_depth`, `replay_resolutions`,
//   `replay_instance_id`, `n` notify, `m` meta, `get_first_bar_time`).
//   Centralising decoder shape prevents drift between tradingview.ts and
//   chart-session-do.ts and gives downstream code a single typed surface to
//   pattern-match on.
//
// BEHAVIOUR
//   - `decodeWSEvent(frame)` returns a `WSEvent` discriminated union if the
//     frame is one of the kinds covered, or `null` for anything we choose
//     not to decode here (e.g. `du`, `timescale_update`, `series_completed`
//     are decoded by their existing call sites for back-compat).
//   - Frames whose method matches a covered verb but whose params shape is
//     malformed return `{ kind: "invalid", reason }`. Callers may treat this
//     as a soft warning rather than a hard fault.
//   - Decoding never throws. We return `null` or an `invalid` variant.

// === Inbound frame shape ==================================================

export interface RawFrame {
  /** Method name; can be any verb TradingView sends. */
  m?: string;
  /** Method name (legacy alias used by some bundles). */
  method?: string;
  /** Params array. */
  p?: any[];
}

// === Discriminated event union ============================================

/** study_loading [slot, turnaround] — fresh pass beginning. */
export interface StudyLoadingEvent {
  kind: "study_loading";
  slot: string;
  turnaround: string;
}

/** tickmark_update [sds_or_st, ...rest] — tickmark labels updated. */
export interface TickmarkUpdateEvent {
  kind: "tickmark_update";
  /** Series or study slot. */
  slot: string;
  /** Trailing positional payload, opaque at decode time. */
  rest: any[];
}

/** index_update [sds_or_st, ...rest] — index recompute notice. */
export interface IndexUpdateEvent {
  kind: "index_update";
  slot: string;
  rest: any[];
}

/** clear_data [slot] — turnaround cleared, caller should resubscribe. */
export interface ClearDataEvent {
  kind: "clear_data";
  slot: string;
}

/** studies_metadata [...] — master schema for built-in studies. */
export interface StudiesMetadataEvent {
  kind: "studies_metadata";
  /** Whatever the server sent in p; opaque blob (schema map). */
  payload: any[];
}

/** protocol_error [reason] — non-fatal protocol error. */
export interface ProtocolErrorEvent {
  kind: "protocol_error";
  reason: string;
  /** Trailing optional details. */
  rest: any[];
}

/** protocol_switched [version] — server upgraded protocol mid-session. */
export interface ProtocolSwitchedEvent {
  kind: "protocol_switched";
  version: string | number;
}

/** critical_error [reason, ...details] — session is being torn down. */
export interface CriticalErrorEvent {
  kind: "critical_error";
  reason: string;
  rest: any[];
}

/** replay_data_end [rs, slot] — replay history exhausted. */
export interface ReplayDataEndEvent {
  kind: "replay_data_end";
  replaySession: string;
  slot: string;
}

/** replay_depth [rs, slot, depth] — max replayable bars for slot. */
export interface ReplayDepthEvent {
  kind: "replay_depth";
  replaySession: string;
  slot: string;
  depth: number;
}

/** replay_resolutions [rs, slot, [resolutions]] — supported tfs for slot. */
export interface ReplayResolutionsEvent {
  kind: "replay_resolutions";
  replaySession: string;
  slot: string;
  resolutions: string[];
}

/** replay_instance_id [rs, slot, instance_id] — server-assigned instance. */
export interface ReplayInstanceIdEvent {
  kind: "replay_instance_id";
  replaySession: string;
  slot: string;
  instanceId: string;
}

/** n — generic notify push (study/ui notifications). */
export interface NotifyEvent {
  kind: "notify";
  /** Whatever the server sent in p; opaque blob. */
  payload: any[];
}

/** m — generic meta push. */
export interface MetaEvent {
  kind: "meta";
  payload: any[];
}

/** get_first_bar_time response [cs, sds, timestamp]. */
export interface GetFirstBarTimeEvent {
  kind: "get_first_bar_time";
  chartSession: string;
  seriesId: string;
  /** Unix seconds of earliest available bar. */
  firstBarTime: number;
}

/** Malformed frame for a covered verb. */
export interface InvalidEvent {
  kind: "invalid";
  /** Original method name from the frame. */
  method: string;
  reason: string;
}

export type WSEvent =
  | StudyLoadingEvent
  | TickmarkUpdateEvent
  | IndexUpdateEvent
  | ClearDataEvent
  | StudiesMetadataEvent
  | ProtocolErrorEvent
  | ProtocolSwitchedEvent
  | CriticalErrorEvent
  | ReplayDataEndEvent
  | ReplayDepthEvent
  | ReplayResolutionsEvent
  | ReplayInstanceIdEvent
  | NotifyEvent
  | MetaEvent
  | GetFirstBarTimeEvent
  | InvalidEvent;

// === Frame-shape helpers =================================================

const getMethod = (frame: RawFrame | null | undefined): string | null => {
  if (!frame || typeof frame !== "object") return null;
  if (typeof frame.m === "string" && frame.m.length > 0) return frame.m;
  if (typeof frame.method === "string" && frame.method.length > 0) return frame.method;
  return null;
};

const getParams = (frame: RawFrame): any[] => (Array.isArray(frame.p) ? frame.p : []);

const invalid = (method: string, reason: string): InvalidEvent => ({
  kind: "invalid",
  method,
  reason,
});

// === Per-verb decoders ===================================================

const decodeStudyLoading = (p: any[]): StudyLoadingEvent | InvalidEvent => {
  if (typeof p[0] !== "string" || typeof p[1] !== "string") {
    return invalid("study_loading", "expected [string slot, string turnaround]");
  }
  return { kind: "study_loading", slot: p[0], turnaround: p[1] };
};

const decodeTickmarkUpdate = (p: any[]): TickmarkUpdateEvent | InvalidEvent => {
  if (typeof p[0] !== "string") {
    return invalid("tickmark_update", "expected [string slot, ...]");
  }
  return { kind: "tickmark_update", slot: p[0], rest: p.slice(1) };
};

const decodeIndexUpdate = (p: any[]): IndexUpdateEvent | InvalidEvent => {
  if (typeof p[0] !== "string") {
    return invalid("index_update", "expected [string slot, ...]");
  }
  return { kind: "index_update", slot: p[0], rest: p.slice(1) };
};

const decodeClearData = (p: any[]): ClearDataEvent | InvalidEvent => {
  // Wire shape variants: some bundles put [cs, slot] (chart-session id then
  // slot), others put [slot] alone. Accept either; carry whichever string
  // looks like a slot ("st<n>" or "sds_<n>") through.
  const candidate = p.find(
    (v) =>
      typeof v === "string" &&
      (v.startsWith("st") || v.startsWith("sds_") || v.startsWith("cs_") === false),
  );
  if (typeof candidate !== "string") {
    return invalid("clear_data", "expected at least one string param");
  }
  // Prefer a slot-shaped string when present.
  const slot =
    p.find((v) => typeof v === "string" && (v.startsWith("st") || v.startsWith("sds_"))) ??
    candidate;
  return { kind: "clear_data", slot: slot as string };
};

const decodeStudiesMetadata = (p: any[]): StudiesMetadataEvent => {
  return { kind: "studies_metadata", payload: p };
};

const decodeProtocolError = (p: any[]): ProtocolErrorEvent | InvalidEvent => {
  if (typeof p[0] !== "string") {
    return invalid("protocol_error", "expected [string reason, ...]");
  }
  return { kind: "protocol_error", reason: p[0], rest: p.slice(1) };
};

const decodeProtocolSwitched = (p: any[]): ProtocolSwitchedEvent | InvalidEvent => {
  if (typeof p[0] !== "string" && typeof p[0] !== "number") {
    return invalid("protocol_switched", "expected [string|number version]");
  }
  return { kind: "protocol_switched", version: p[0] };
};

const decodeCriticalError = (p: any[]): CriticalErrorEvent | InvalidEvent => {
  if (typeof p[0] !== "string") {
    return invalid("critical_error", "expected [string reason, ...]");
  }
  return { kind: "critical_error", reason: p[0], rest: p.slice(1) };
};

const decodeReplayDataEnd = (p: any[]): ReplayDataEndEvent | InvalidEvent => {
  if (typeof p[0] !== "string" || typeof p[1] !== "string") {
    return invalid("replay_data_end", "expected [string rs, string slot]");
  }
  return { kind: "replay_data_end", replaySession: p[0], slot: p[1] };
};

const decodeReplayDepth = (p: any[]): ReplayDepthEvent | InvalidEvent => {
  if (typeof p[0] !== "string" || typeof p[1] !== "string" || typeof p[2] !== "number") {
    return invalid("replay_depth", "expected [string rs, string slot, number depth]");
  }
  return { kind: "replay_depth", replaySession: p[0], slot: p[1], depth: p[2] };
};

const decodeReplayResolutions = (p: any[]): ReplayResolutionsEvent | InvalidEvent => {
  if (typeof p[0] !== "string" || typeof p[1] !== "string" || !Array.isArray(p[2])) {
    return invalid("replay_resolutions", "expected [string rs, string slot, string[] resolutions]");
  }
  for (const r of p[2]) {
    if (typeof r !== "string") {
      return invalid("replay_resolutions", "resolutions[] must be all strings");
    }
  }
  return { kind: "replay_resolutions", replaySession: p[0], slot: p[1], resolutions: p[2] };
};

const decodeReplayInstanceId = (p: any[]): ReplayInstanceIdEvent | InvalidEvent => {
  if (typeof p[0] !== "string" || typeof p[1] !== "string" || typeof p[2] !== "string") {
    return invalid(
      "replay_instance_id",
      "expected [string rs, string slot, string instance_id]",
    );
  }
  return { kind: "replay_instance_id", replaySession: p[0], slot: p[1], instanceId: p[2] };
};

const decodeNotify = (p: any[]): NotifyEvent => ({ kind: "notify", payload: p });

const decodeMeta = (p: any[]): MetaEvent => ({ kind: "meta", payload: p });

const decodeGetFirstBarTime = (p: any[]): GetFirstBarTimeEvent | InvalidEvent => {
  // Documented response shape per recon: [cs, sds, timestamp]. Some bundles
  // omit the chart_session prefix and emit [sds, timestamp] - accept both.
  if (
    p.length >= 3 &&
    typeof p[0] === "string" &&
    typeof p[1] === "string" &&
    typeof p[2] === "number"
  ) {
    return { kind: "get_first_bar_time", chartSession: p[0], seriesId: p[1], firstBarTime: p[2] };
  }
  if (p.length >= 2 && typeof p[0] === "string" && typeof p[1] === "number") {
    return { kind: "get_first_bar_time", chartSession: "", seriesId: p[0], firstBarTime: p[1] };
  }
  return invalid("get_first_bar_time", "expected [cs?, sds, timestamp]");
};

// === Main entry ==========================================================

/**
 * Decode a single inbound chart-session frame into a typed event. Returns
 * `null` for verbs this module deliberately doesn't handle (e.g. `du`,
 * `timescale_update`, `series_*`, `study_completed`, `study_error`,
 * `qsd`, `quote_completed`, `symbol_resolved`, `symbol_error`,
 * `replay_ok`, `replay_error`, `replay_point`).
 */
export const decodeWSEvent = (frame: RawFrame | null | undefined): WSEvent | null => {
  const method = getMethod(frame);
  if (!method) return null;
  const p = getParams(frame as RawFrame);

  switch (method) {
    case "study_loading":
      return decodeStudyLoading(p);
    case "tickmark_update":
      return decodeTickmarkUpdate(p);
    case "index_update":
      return decodeIndexUpdate(p);
    case "clear_data":
      return decodeClearData(p);
    case "studies_metadata":
      return decodeStudiesMetadata(p);
    case "protocol_error":
      return decodeProtocolError(p);
    case "protocol_switched":
      return decodeProtocolSwitched(p);
    case "critical_error":
      return decodeCriticalError(p);
    case "replay_data_end":
      return decodeReplayDataEnd(p);
    case "replay_depth":
      return decodeReplayDepth(p);
    case "replay_resolutions":
      return decodeReplayResolutions(p);
    case "replay_instance_id":
      return decodeReplayInstanceId(p);
    case "n":
      return decodeNotify(p);
    case "m":
      return decodeMeta(p);
    case "get_first_bar_time":
      return decodeGetFirstBarTime(p);
    default:
      return null;
  }
};
