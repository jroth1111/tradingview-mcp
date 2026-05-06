// StreamBridge Durable Object (P18 / tradingview-zkz)
//
// One DO instance owns at most one upstream pushstream WebSocket and one
// upstream notifications WebSocket per session. It buffers decoded events
// in an in-memory ring buffer (max RING_BUFFER_MAX entries) and exposes
// internal HTTP routes the Worker forwards onto:
//   POST /subscribe-alerts  — bind/refresh pushstream connection
//   POST /subscribe-news    — bind/refresh notifications connection
//   POST /poll              — drain events since cursor (timestamp/seq)
//   GET  /sse               — open SSE long-poll to a client
//   POST /close             — release upstream sockets
//
// All routes are addressed via stub.fetch() with `https://stream-bridge.internal/...`.
// The Worker addresses one DO instance per `sessionToken`, mirroring the
// chart-session DO pattern.

import {
  PUSHSTREAM_CHANNELS,
  buildPushstreamSseUrl,
  buildPushstreamUpgradeHeaders,
  buildPushstreamWsUrl,
  extractPrivateChannelToken,
  isBootstrapFrame,
  parsePushstreamEvent,
  parsePushstreamFrame,
  type PushstreamEvent,
  type PushstreamFrame,
} from "./pushstream";
import {
  buildNotificationsUpgradeHeaders,
  buildNotificationsUrl,
  parseNewsFrame,
  type NewsStreamEvent,
} from "./notifications";

// === Public types (also referenced from index.ts) ===

export interface AlertFireEvent {
  alert_id?: number;
  fire_id?: number;
  fire_time?: string | number;
  bar_time?: string | number;
  value?: number;
  last_value?: number;
  message?: string;
  alert_snapshot?: any;
}

export interface SubscribeAlertsRequest {
  /** TradingView session id (cookie). Required for private channel. */
  sessionId: string;
  sessionSign?: string;
  /** Per-user private channel token; if absent, bootstrap is used. */
  privateChannel?: string;
  /** Whether to also subscribe to the `public` channel. Default: true. */
  includePublic?: boolean;
}

export interface SubscribeNewsRequest {
  sessionId?: string;
  sessionSign?: string;
  /** Optional Worker-side symbol filter. */
  symbols?: string[];
}

export interface PollRequest {
  /** ISO timestamp; only events with `ts > since` are returned. */
  since?: string;
  /** Channel filter: "alerts" | "news" | "all". */
  channel?: "alerts" | "news" | "all";
  /** Soft cap on returned events (clamped server-side). */
  limit?: number;
}

export type StreamEventKind = "alert" | "news" | "control";

export interface BufferedEvent {
  /** Monotonic sequence id (set on enqueue, never reused). */
  seq: number;
  /** ISO timestamp the DO observed this event. */
  ts: string;
  kind: StreamEventKind;
  /** Stream channel — pushstream channel name, or "news". */
  channel: string;
  /** Verb: pushstream `m` (e.g. alert_fired), or "news". */
  event: string;
  /** Payload extracted from the upstream envelope. */
  data: any;
}

export interface PollResponse {
  ok: true;
  events: BufferedEvent[];
  cursor: string;
  /** True when the buffer overflowed and earlier events were dropped. */
  truncated: boolean;
}

export interface StreamBridgeBindings {
  STREAM_BRIDGE: {
    idFromName: (name: string) => any;
    get: (id: any) => { fetch: (url: string, init?: RequestInit) => Promise<Response> };
  };
}

// === Test seams =========================================================

/**
 * Override hook for tests. Production callers always use the default
 * `fetch`-based upgrade; tests inject a fake to drive the DO without
 * opening real sockets.
 */
export interface UpstreamFactoryOptions {
  url: string;
  headers: Record<string, string>;
  kind: "pushstream" | "notifications";
}

export interface UpstreamSocket {
  send: (data: string) => void;
  close: (code?: number, reason?: string) => void;
  /** Wired by the DO; tests call to push frames into the consumer. */
  emitMessage?: (text: string) => void;
  emitClose?: (code: number, reason: string) => void;
  emitError?: (err: any) => void;
}

export type UpstreamFactory = (
  opts: UpstreamFactoryOptions,
  handlers: {
    onMessage: (text: string) => void;
    onClose?: (code: number, reason: string) => void;
    onError?: (err: any) => void;
    onOpen?: () => void;
  },
) => Promise<UpstreamSocket>;

let upstreamFactory: UpstreamFactory | null = null;
export const _setUpstreamFactoryForTests = (factory: UpstreamFactory | null) => {
  upstreamFactory = factory;
};

/**
 * Default upstream factory: opens a real WebSocket via `fetch()` upgrade
 * (the only way to attach Cookie headers in a Worker / DO).
 */
const defaultUpstreamFactory: UpstreamFactory = async (opts, handlers) => {
  const resp = await fetch(opts.url.replace(/^wss:/, "https:"), {
    headers: opts.headers,
  });
  // Cloudflare returns the upgraded socket on `webSocket` when the
  // response status is 101.
  const ws = (resp as any).webSocket as WebSocket | undefined;
  if (!ws) {
    throw new Error(
      `upstream WS upgrade failed: status=${resp.status} kind=${opts.kind}`,
    );
  }
  ws.accept();
  ws.addEventListener("message", (ev: any) => {
    const text = typeof ev.data === "string" ? ev.data : String(ev.data);
    handlers.onMessage(text);
  });
  if (handlers.onClose) {
    ws.addEventListener("close", (ev: any) =>
      handlers.onClose?.(ev?.code ?? 1006, ev?.reason ?? ""),
    );
  }
  if (handlers.onError) {
    ws.addEventListener("error", (ev: any) => handlers.onError?.(ev));
  }
  if (handlers.onOpen) ws.addEventListener("open", () => handlers.onOpen?.());
  return {
    send: (data: string) => ws.send(data),
    close: (code = 1000, reason = "client_closed") => {
      try {
        ws.close(code, reason);
      } catch {
        /* ignore */
      }
    },
  };
};

// === Internals =========================================================

const RING_BUFFER_MAX = 1000;
const SSE_HEARTBEAT_MS = 15_000;
const SSE_DEFAULT_MAX_AGE_MS = 4 * 60 * 1000; // Cloudflare Worker hard wall-clock guard.

interface SubscriptionState {
  /** Buffer of events; oldest first. */
  ring: BufferedEvent[];
  /** Monotonic counter; never reused even after overflow. */
  nextSeq: number;
  /** True when the buffer rolled past RING_BUFFER_MAX at least once. */
  truncated: boolean;
  pushstream: {
    socket: UpstreamSocket | null;
    channels: string[];
    privateChannel: string | null;
  };
  notifications: {
    socket: UpstreamSocket | null;
    symbolFilter: string[] | null;
  };
}

const newSubscriptionState = (): SubscriptionState => ({
  ring: [],
  nextSeq: 1,
  truncated: false,
  pushstream: { socket: null, channels: [], privateChannel: null },
  notifications: { socket: null, symbolFilter: null },
});

// === StreamBridge DO =====================================================

export class StreamBridge {
  private state: DurableObjectState;
  private env: CloudflareBindings;
  private sub: SubscriptionState;
  /** SSE connections currently attached, keyed by stable id. */
  private sseClients = new Map<
    string,
    { writer: WritableStreamDefaultWriter<Uint8Array>; closed: boolean }
  >();

  constructor(state: DurableObjectState, env: CloudflareBindings) {
    this.state = state;
    this.env = env;
    this.sub = newSubscriptionState();
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    if (path === "/sse" && request.method === "GET") {
      return this.handleSse(request);
    }
    if (request.method !== "POST") {
      return Response.json({ error: "method not allowed" }, { status: 405 });
    }
    try {
      switch (path) {
        case "/subscribe-alerts":
          return await this.handleSubscribeAlerts(request);
        case "/subscribe-news":
          return await this.handleSubscribeNews(request);
        case "/poll":
          return await this.handlePoll(request);
        case "/close":
          return await this.handleClose();
        default:
          return Response.json({ error: `unknown sub-path: ${path}` }, { status: 404 });
      }
    } catch (err: any) {
      return Response.json({ error: err?.message || "stream-bridge error" }, { status: 500 });
    }
  }

  // --- handlers ---

  private async handleSubscribeAlerts(request: Request): Promise<Response> {
    let body: SubscribeAlertsRequest;
    try {
      body = (await request.json()) as SubscribeAlertsRequest;
    } catch {
      return Response.json({ error: "invalid JSON body" }, { status: 400 });
    }
    if (!body || typeof body.sessionId !== "string" || !body.sessionId) {
      return Response.json({ error: "sessionId (string) required" }, { status: 400 });
    }
    // Tear down any prior pushstream connection — /subscribe-alerts is
    // the explicit reset point for the alerts upstream.
    if (this.sub.pushstream.socket) {
      this.sub.pushstream.socket.close(1000, "resubscribe");
      this.sub.pushstream.socket = null;
    }
    const includePublic = body.includePublic !== false;
    const channels: string[] = [];
    if (body.privateChannel) {
      channels.push(PUSHSTREAM_CHANNELS.private_(body.privateChannel));
    } else {
      // Bootstrap channel — the upstream will publish the per-user channel
      // id on the first frame; the DO captures it and adds the private
      // channel to its known set so future poll/sse calls report it.
      channels.push(PUSHSTREAM_CHANNELS.bootstrap);
    }
    if (includePublic) channels.push(PUSHSTREAM_CHANNELS.public);

    const url = buildPushstreamWsUrl(channels);
    const headers = buildPushstreamUpgradeHeaders(body.sessionId, body.sessionSign);
    const factory = upstreamFactory ?? defaultUpstreamFactory;
    const socket = await factory(
      { url, headers, kind: "pushstream" },
      {
        onMessage: (text) => this.onPushstreamMessage(text, body),
        onClose: (code, reason) => this.onUpstreamClose("pushstream", code, reason),
        onError: (err) => this.onUpstreamError("pushstream", err),
      },
    );
    this.sub.pushstream.socket = socket;
    this.sub.pushstream.channels = channels;
    this.sub.pushstream.privateChannel = body.privateChannel ?? null;
    return Response.json({
      ok: true,
      channels,
      privateChannel: body.privateChannel ?? null,
      sseUrlFallback: buildPushstreamSseUrl(channels),
    });
  }

  private async handleSubscribeNews(request: Request): Promise<Response> {
    let body: SubscribeNewsRequest;
    try {
      body = (await request.json()) as SubscribeNewsRequest;
    } catch {
      return Response.json({ error: "invalid JSON body" }, { status: 400 });
    }
    if (this.sub.notifications.socket) {
      this.sub.notifications.socket.close(1000, "resubscribe");
      this.sub.notifications.socket = null;
    }
    const url = buildNotificationsUrl();
    const headers = buildNotificationsUpgradeHeaders(body?.sessionId, body?.sessionSign);
    const factory = upstreamFactory ?? defaultUpstreamFactory;
    const socket = await factory(
      { url, headers, kind: "notifications" },
      {
        onMessage: (text) => this.onNotificationsMessage(text),
        onClose: (code, reason) => this.onUpstreamClose("notifications", code, reason),
        onError: (err) => this.onUpstreamError("notifications", err),
      },
    );
    this.sub.notifications.socket = socket;
    this.sub.notifications.symbolFilter =
      Array.isArray(body?.symbols) && body!.symbols!.length > 0 ? [...body!.symbols!] : null;
    return Response.json({
      ok: true,
      url,
      symbolFilter: this.sub.notifications.symbolFilter,
    });
  }

  private async handlePoll(request: Request): Promise<Response> {
    let body: PollRequest;
    try {
      body = (await request.json()) as PollRequest;
    } catch {
      // Empty body is acceptable — drains everything.
      body = {};
    }
    const limit = clampLimit(body?.limit);
    const channel = body?.channel ?? "all";
    const sinceMs = parseSinceMs(body?.since);
    const filtered: BufferedEvent[] = [];
    for (const ev of this.sub.ring) {
      if (sinceMs != null && Date.parse(ev.ts) <= sinceMs) continue;
      if (channel === "alerts" && ev.kind !== "alert") continue;
      if (channel === "news" && ev.kind !== "news") continue;
      filtered.push(ev);
      if (filtered.length >= limit) break;
    }
    const cursor =
      filtered.length > 0 ? filtered[filtered.length - 1].ts : (body?.since ?? new Date().toISOString());
    const resp: PollResponse = {
      ok: true,
      events: filtered,
      cursor,
      truncated: this.sub.truncated,
    };
    return Response.json(resp);
  }

  private async handleClose(): Promise<Response> {
    if (this.sub.pushstream.socket) {
      this.sub.pushstream.socket.close(1000, "client_closed");
    }
    if (this.sub.notifications.socket) {
      this.sub.notifications.socket.close(1000, "client_closed");
    }
    for (const [, client] of this.sseClients) {
      try {
        await client.writer.close();
      } catch {
        /* ignore */
      }
    }
    this.sseClients.clear();
    this.sub = newSubscriptionState();
    return Response.json({ ok: true });
  }

  private handleSse(request: Request): Response {
    // Build SSE response. Cloudflare Workers cap a single fetch at ~30s
    // for non-Hibernatable cases, but Durable Objects with `fetch()`
    // upgrades and `WebSocketPair` are exempt; for SSE we cap with a
    // wall-clock guard so clients always get a clean close they can
    // reconnect from. Clients should reconnect on close.
    const url = new URL(request.url);
    const sinceParam = url.searchParams.get("since");
    const channelParam = url.searchParams.get("channel") ?? "all";
    const maxAgeMs = SSE_DEFAULT_MAX_AGE_MS;
    const id = `sse_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

    const stream = new TransformStream<Uint8Array, Uint8Array>();
    const writer = stream.writable.getWriter();
    const encoder = new TextEncoder();
    const sendEvent = async (chunk: string) => {
      try {
        await writer.write(encoder.encode(chunk));
      } catch {
        // Closed by client.
        const entry = this.sseClients.get(id);
        if (entry) entry.closed = true;
      }
    };

    // Replay buffered events first so the client doesn't miss anything
    // between disconnect and reconnect.
    const sinceMs = parseSinceMs(sinceParam ?? undefined);
    const replay = this.sub.ring.filter((ev) => {
      if (sinceMs != null && Date.parse(ev.ts) <= sinceMs) return false;
      if (channelParam === "alerts" && ev.kind !== "alert") return false;
      if (channelParam === "news" && ev.kind !== "news") return false;
      return true;
    });
    void (async () => {
      // Emit retry hint for browsers (3s).
      await sendEvent(`retry: 3000\n\n`);
      for (const ev of replay) {
        await sendEvent(formatSseEvent(ev));
      }
      // Heartbeat + wall-clock guard. The interval is approximate — DOs
      // run on real timers; we cap with a Date check so clock skew
      // cannot push a connection past the configured maxAge.
      const start = Date.now();
      const tick = async () => {
        const entry = this.sseClients.get(id);
        if (!entry || entry.closed) return;
        if (Date.now() - start >= maxAgeMs) {
          await sendEvent(`event: close\ndata: {"reason":"max_age"}\n\n`);
          await writer.close().catch(() => {});
          this.sseClients.delete(id);
          return;
        }
        await sendEvent(`: heartbeat\n\n`);
        setTimeout(tick, SSE_HEARTBEAT_MS);
      };
      setTimeout(tick, SSE_HEARTBEAT_MS);
    })();

    this.sseClients.set(id, { writer, closed: false });

    return new Response(stream.readable, {
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-stream-id": id,
      },
    });
  }

  // --- upstream pumps ---

  private onPushstreamMessage(text: string, ctx: SubscribeAlertsRequest) {
    let frame: PushstreamFrame;
    try {
      frame = parsePushstreamFrame(text);
    } catch {
      // Drop malformed frames; do not poison the buffer.
      return;
    }
    // Bootstrap: server publishes the per-user private channel id; if we
    // haven't subscribed to it yet, open a follow-up subscribe and add it
    // to the channel list so future polls report alert fires.
    if (isBootstrapFrame(frame)) {
      const token = extractPrivateChannelToken(frame);
      if (token && this.sub.pushstream.privateChannel !== token) {
        this.sub.pushstream.privateChannel = token;
        this.enqueueControlEvent({
          channel: PUSHSTREAM_CHANNELS.bootstrap,
          event: "private_channel_minted",
          data: { privateChannel: token },
        });
        // Re-open with the private channel attached. We do this best-effort:
        // re-subscribe asynchronously and surface failures via the buffer.
        void this.attachPrivateChannel(token, ctx).catch((err) =>
          this.enqueueControlEvent({
            channel: PUSHSTREAM_CHANNELS.bootstrap,
            event: "private_channel_attach_failed",
            data: { error: err?.message || String(err) },
          }),
        );
      }
      return;
    }
    let event: PushstreamEvent | null;
    try {
      event = parsePushstreamEvent(frame);
    } catch {
      return;
    }
    if (!event) return; // keepalive / channel-removed
    this.enqueueAlertEvent(event);
  }

  private async attachPrivateChannel(token: string, ctx: SubscribeAlertsRequest) {
    const channels: string[] = [PUSHSTREAM_CHANNELS.private_(token)];
    if (ctx.includePublic !== false) channels.push(PUSHSTREAM_CHANNELS.public);
    if (this.sub.pushstream.socket) {
      this.sub.pushstream.socket.close(1000, "switch_to_private");
      this.sub.pushstream.socket = null;
    }
    const url = buildPushstreamWsUrl(channels);
    const headers = buildPushstreamUpgradeHeaders(ctx.sessionId, ctx.sessionSign);
    const factory = upstreamFactory ?? defaultUpstreamFactory;
    const socket = await factory(
      { url, headers, kind: "pushstream" },
      {
        onMessage: (text) => this.onPushstreamMessage(text, { ...ctx, privateChannel: token }),
        onClose: (code, reason) => this.onUpstreamClose("pushstream", code, reason),
        onError: (err) => this.onUpstreamError("pushstream", err),
      },
    );
    this.sub.pushstream.socket = socket;
    this.sub.pushstream.channels = channels;
  }

  private onNotificationsMessage(text: string) {
    let event: NewsStreamEvent;
    try {
      event = parseNewsFrame(text);
    } catch {
      return;
    }
    if (
      this.sub.notifications.symbolFilter &&
      this.sub.notifications.symbolFilter.length > 0 &&
      event.symbols &&
      event.symbols.length > 0
    ) {
      const allow = new Set(this.sub.notifications.symbolFilter);
      const match = event.symbols.some((s) => allow.has(s));
      if (!match) return;
    }
    const buffered: BufferedEvent = {
      seq: this.sub.nextSeq++,
      ts: new Date().toISOString(),
      kind: "news",
      channel: event.channel ?? "news",
      event: event.kind,
      data: {
        id: event.id,
        title: event.title,
        symbols: event.symbols,
        published: event.published,
        provider: event.provider,
        raw: event.raw,
      },
    };
    this.pushEvent(buffered);
  }

  private onUpstreamClose(kind: "pushstream" | "notifications", code: number, reason: string) {
    this.enqueueControlEvent({
      channel: kind,
      event: "upstream_closed",
      data: { code, reason },
    });
    if (kind === "pushstream") this.sub.pushstream.socket = null;
    else this.sub.notifications.socket = null;
  }

  private onUpstreamError(kind: "pushstream" | "notifications", err: any) {
    this.enqueueControlEvent({
      channel: kind,
      event: "upstream_error",
      data: { error: err?.message || String(err) },
    });
  }

  private enqueueAlertEvent(event: PushstreamEvent) {
    const buffered: BufferedEvent = {
      seq: this.sub.nextSeq++,
      ts: new Date().toISOString(),
      kind: "alert",
      channel: event.channel,
      event: event.m,
      data: event.p,
    };
    this.pushEvent(buffered);
  }

  private enqueueControlEvent(args: { channel: string; event: string; data: any }) {
    const buffered: BufferedEvent = {
      seq: this.sub.nextSeq++,
      ts: new Date().toISOString(),
      kind: "control",
      channel: args.channel,
      event: args.event,
      data: args.data,
    };
    this.pushEvent(buffered);
  }

  private pushEvent(ev: BufferedEvent) {
    this.sub.ring.push(ev);
    if (this.sub.ring.length > RING_BUFFER_MAX) {
      this.sub.ring.splice(0, this.sub.ring.length - RING_BUFFER_MAX);
      this.sub.truncated = true;
    }
    // Fan out to attached SSE clients.
    const chunk = formatSseEvent(ev);
    for (const [id, client] of this.sseClients) {
      if (client.closed) {
        this.sseClients.delete(id);
        continue;
      }
      void client.writer.write(new TextEncoder().encode(chunk)).catch(() => {
        client.closed = true;
        this.sseClients.delete(id);
      });
    }
  }

  // --- test hooks ---

  /** Read-only snapshot for tests. */
  _state(): {
    ringLength: number;
    truncated: boolean;
    nextSeq: number;
    pushstreamChannels: string[];
    privateChannel: string | null;
    notificationsBound: boolean;
    sseClients: number;
  } {
    return {
      ringLength: this.sub.ring.length,
      truncated: this.sub.truncated,
      nextSeq: this.sub.nextSeq,
      pushstreamChannels: [...this.sub.pushstream.channels],
      privateChannel: this.sub.pushstream.privateChannel,
      notificationsBound: this.sub.notifications.socket != null,
      sseClients: this.sseClients.size,
    };
  }

  /**
   * Test hook: directly inject a frame into the consumer as if it had
   * arrived from the upstream pushstream socket.
   */
  _injectPushstreamFrame(text: string, ctx: SubscribeAlertsRequest) {
    this.onPushstreamMessage(text, ctx);
  }

  /**
   * Test hook: directly inject a frame into the news consumer.
   */
  _injectNotificationsFrame(text: string) {
    this.onNotificationsMessage(text);
  }
}

// === Helpers ============================================================

const clampLimit = (n: number | undefined): number => {
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return RING_BUFFER_MAX;
  return Math.min(Math.floor(n), RING_BUFFER_MAX);
};

const parseSinceMs = (since: string | undefined): number | null => {
  if (!since) return null;
  const ms = Date.parse(since);
  return Number.isNaN(ms) ? null : ms;
};

const formatSseEvent = (ev: BufferedEvent): string => {
  // SSE uses LF-terminated `field: value` lines with a blank line between
  // events. We embed the seq as the SSE event id so clients can use
  // Last-Event-ID for resumption.
  const lines = [
    `id: ${ev.seq}`,
    `event: ${ev.kind}.${sanitizeSseField(ev.event)}`,
    `data: ${JSON.stringify({ seq: ev.seq, ts: ev.ts, channel: ev.channel, event: ev.event, data: ev.data })}`,
  ];
  return lines.join("\n") + "\n\n";
};

const sanitizeSseField = (s: string): string => s.replace(/[\r\n]/g, "_");

export { RING_BUFFER_MAX };
