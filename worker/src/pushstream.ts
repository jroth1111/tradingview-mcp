// pushstream.tradingview.com client (P18 / tradingview-zkz)
//
// Surface: nginx_push_stream_module (NOT Engine.IO/Socket.IO).
//   - WS endpoint: wss://pushstream.tradingview.com/message-pipe-ws/<chan1>/<chan2>/...
//   - SSE endpoint: https://pushstream.tradingview.com/message-pipe-es?channel=...
//   - Library: nginx_push_stream_module — channel-based, no per-topic
//     subscribe verb. Channels are appended to the URL path; the server
//     pushes any message published to those channels.
//
// Frame envelope: {id, channel, text} where:
//   - id <= -2 → channel removed/closed by server
//   - id  >  0 → payload frame; `text` parses to {m: <event>, p: <data>}
//   - id  ==  0 / -1 → server keepalive / handshake; ignored
//
// Two parallel SPA connections per tab:
//   - _pushStreamPublic  : multi-channel (`public` plus auxiliary news, etc.)
//   - _pushStreamPrivate : single channel `private_<user.private_channel>`
//
// Bootstrap channel: `pushstream_set_user_channel` — server publishes the
// per-user channel id once cookies authenticate; the SPA then opens the
// private connection. The Worker bridges by either:
//   a) accepting `privateChannel` directly from the admin session record
//      (already populated by the session-store endpoint), or
//   b) attaching to `pushstream_set_user_channel` and waiting for the
//      bootstrap frame.
//
// Worker constraints: Cloudflare Workers cannot keep a long-lived WS
// upstream past the request lifetime. The Durable Object that owns this
// client (StreamBridge) is responsible for keeping the socket alive and
// re-fanning frames to clients via SSE / poll. This module only exposes
// the framer + connect primitive; it does NOT spawn timers or own state
// beyond the open WebSocket.

const PUSHSTREAM_WS_HOST = "wss://pushstream.tradingview.com";
const PUSHSTREAM_SSE_HOST = "https://pushstream.tradingview.com";
const TV_ORIGIN = "https://www.tradingview.com";
const PUBLIC_CHANNEL = "public";
const BOOTSTRAP_CHANNEL = "pushstream_set_user_channel";

export interface PushstreamFrame {
  /** Frame id; nginx_push_stream uses positive ids for payloads. */
  id: number;
  /** Channel name the frame was published on. */
  channel: string;
  /** Raw message body (may be JSON parseable to {m, p}). */
  text: string;
}

export interface PushstreamEvent {
  id: number;
  channel: string;
  /** Event verb extracted from `text`'s `m` field, e.g. `alert_fired`. */
  m: string;
  /** Event payload extracted from `text`'s `p` field. */
  p: any;
  /** Original raw text for callers that need full fidelity. */
  rawText: string;
}

/** Build the pushstream WS URL for the supplied channel list. */
export const buildPushstreamWsUrl = (channels: string[]): string => {
  if (channels.length === 0) {
    throw new Error("pushstream WS requires at least one channel");
  }
  // The nginx module uses path segments: /message-pipe-ws/chan1/chan2/...
  // Channel names are restricted to URL-safe characters; encodeURIComponent is
  // a defensive measure (server-observed names so far are alphanumeric + `_`).
  const encoded = channels.map((c) => encodeURIComponent(c)).join("/");
  return `${PUSHSTREAM_WS_HOST}/message-pipe-ws/${encoded}`;
};

/** Build the pushstream SSE URL for the supplied channel list (fallback transport). */
export const buildPushstreamSseUrl = (channels: string[]): string => {
  if (channels.length === 0) {
    throw new Error("pushstream SSE requires at least one channel");
  }
  // The SSE alternate uses query params, one channel per param. Confirmed
  // bundle-side via `enable_eventsource_pushstream_transport`.
  const params = new URLSearchParams();
  for (const c of channels) params.append("channel", c);
  return `${PUSHSTREAM_SSE_HOST}/message-pipe-es?${params.toString()}`;
};

/** Convenience constants for callers building channel lists. */
export const PUSHSTREAM_CHANNELS = {
  public: PUBLIC_CHANNEL,
  bootstrap: BOOTSTRAP_CHANNEL,
  private_: (privateChannelToken: string) => `private_${privateChannelToken}`,
} as const;

/**
 * Parse a single nginx_push_stream envelope. Throws on malformed JSON or
 * missing required fields. Frames where `id <= 0` are returned (caller
 * decides keepalive vs payload by inspecting `id`).
 */
export const parsePushstreamFrame = (raw: string): PushstreamFrame => {
  if (typeof raw !== "string" || raw.length === 0) {
    throw new Error("pushstream frame is empty");
  }
  let data: any;
  try {
    data = JSON.parse(raw);
  } catch (err: any) {
    throw new Error(`pushstream frame is not JSON: ${err?.message || err}`);
  }
  if (!data || typeof data !== "object") {
    throw new Error("pushstream frame must be an object");
  }
  if (typeof data.id !== "number") {
    throw new Error("pushstream frame missing numeric `id`");
  }
  if (typeof data.channel !== "string") {
    throw new Error("pushstream frame missing string `channel`");
  }
  // `text` is always present on payload frames; allow empty string for
  // keepalive/control frames (id <= 0) by defaulting.
  const text = typeof data.text === "string" ? data.text : "";
  return { id: data.id, channel: data.channel, text };
};

/**
 * Parse a pushstream payload frame. Returns null for frames that are not
 * payload frames (id <= 0 keepalive/channel-removed). Throws when `text`
 * is non-empty but unparseable as the {m, p} event envelope.
 */
export const parsePushstreamEvent = (frame: PushstreamFrame): PushstreamEvent | null => {
  // id == -2 means channel removed; id == -1/0 means keepalive/handshake.
  if (frame.id <= 0 || frame.text.length === 0) return null;
  let inner: any;
  try {
    inner = JSON.parse(frame.text);
  } catch (err: any) {
    throw new Error(`pushstream event text is not JSON: ${err?.message || err}`);
  }
  if (!inner || typeof inner !== "object") {
    throw new Error("pushstream event text must be a JSON object");
  }
  const m = typeof inner.m === "string" ? inner.m : "";
  const p = inner.p;
  return {
    id: frame.id,
    channel: frame.channel,
    m,
    p,
    rawText: frame.text,
  };
};

/**
 * Predicate: was this frame produced by the bootstrap channel that mints
 * the user's private channel id?
 */
export const isBootstrapFrame = (frame: PushstreamFrame): boolean =>
  frame.channel === BOOTSTRAP_CHANNEL;

/**
 * Extract the per-user private channel token from a bootstrap frame.
 *
 * Observed shape (best-effort, see residuals): the `text` field carries
 * either a plain string token, or a JSON object with `private_channel`
 * key. Treat both cases. Returns null when no token can be extracted.
 */
export const extractPrivateChannelToken = (frame: PushstreamFrame): string | null => {
  if (!isBootstrapFrame(frame)) return null;
  const text = frame.text.trim();
  if (text.length === 0) return null;
  // Plain string token (no JSON wrapping).
  if (text[0] !== "{" && text[0] !== "[") {
    return text.replace(/^"+|"+$/g, "");
  }
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed === "string") return parsed;
    if (parsed && typeof parsed.private_channel === "string") return parsed.private_channel;
    if (parsed && typeof parsed.p === "string") return parsed.p;
    if (parsed && Array.isArray(parsed.p) && typeof parsed.p[0] === "string") return parsed.p[0];
  } catch {
    // fall through
  }
  return null;
};

/** Options for opening a pushstream WebSocket. */
export interface PushstreamConnectOptions {
  channels: string[];
  /** Cookie pair from the admin session store (sessionId required for private). */
  sessionId?: string;
  sessionSign?: string;
  /** Constructor injection for tests; falls back to global WebSocket. */
  webSocketImpl?: { new (url: string, protocols?: string[] | string): WebSocket };
}

export interface PushstreamHandlers {
  onFrame: (frame: PushstreamFrame) => void;
  onError?: (err: any) => void;
  onClose?: (code: number, reason: string) => void;
  onOpen?: () => void;
}

export interface PushstreamConnection {
  ws: WebSocket;
  url: string;
  channels: string[];
  close: (code?: number, reason?: string) => void;
}

/**
 * Open a pushstream WebSocket and wire the supplied handlers. The
 * standard browser WebSocket API does not let us attach Cookie headers
 * directly; in Workers we rely on credentialed `fetch()` upgrade or a
 * raw socket. Callers running inside a Durable Object should instead use
 * `fetch()` with `Upgrade: websocket` so the Worker runtime injects the
 * cookies that came from the admin session store via `sessionId`/
 * `sessionSign`. This helper currently leaves that wiring to the DO
 * (see stream-do.ts) but keeps the framing logic shared.
 */
export const openPushstream = (
  opts: PushstreamConnectOptions,
  handlers: PushstreamHandlers,
): PushstreamConnection => {
  const url = buildPushstreamWsUrl(opts.channels);
  const Impl = opts.webSocketImpl ?? (globalThis as any).WebSocket;
  if (!Impl) throw new Error("WebSocket constructor not available");
  const ws = new Impl(url) as WebSocket;
  ws.addEventListener("message", (ev: any) => {
    try {
      const frame = parsePushstreamFrame(typeof ev.data === "string" ? ev.data : String(ev.data));
      handlers.onFrame(frame);
    } catch (err) {
      handlers.onError?.(err);
    }
  });
  if (handlers.onOpen) ws.addEventListener("open", () => handlers.onOpen?.());
  if (handlers.onError) ws.addEventListener("error", (ev: any) => handlers.onError?.(ev));
  if (handlers.onClose) {
    ws.addEventListener("close", (ev: any) =>
      handlers.onClose?.(ev?.code ?? 1006, ev?.reason ?? ""),
    );
  }
  return {
    ws,
    url,
    channels: [...opts.channels],
    close: (code = 1000, reason = "client_closed") => {
      try {
        ws.close(code, reason);
      } catch {
        /* ignore */
      }
    },
  };
};

/**
 * Build the cookie header value used when upgrading via fetch() inside a
 * Durable Object. Pushstream authenticates by cookie on handshake.
 */
export const buildPushstreamCookie = (
  sessionId: string,
  sessionSign?: string,
): string =>
  sessionSign ? `sessionid=${sessionId};sessionid_sign=${sessionSign}` : `sessionid=${sessionId}`;

/** Required headers when upgrading to pushstream WS via Worker fetch(). */
export const buildPushstreamUpgradeHeaders = (
  sessionId?: string,
  sessionSign?: string,
): Record<string, string> => {
  const headers: Record<string, string> = {
    Upgrade: "websocket",
    Origin: TV_ORIGIN,
    "User-Agent":
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  };
  if (sessionId) headers.Cookie = buildPushstreamCookie(sessionId, sessionSign);
  return headers;
};
