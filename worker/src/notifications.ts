// notifications.tradingview.com client (P18 / tradingview-zkz)
//
// Surface: wss://notifications.tradingview.com/news/channel
//   - Cookie-on-handshake authentication (same sessionid/sessionid_sign
//     pair used elsewhere). The host is preconnected with
//     `crossorigin="use-credentials"` from chart pages.
//   - Frame format observed via mediator bundle 68044 + chart bundle:
//     news arrives as JSON objects with `{kind, item}` or `{news_id, …}`
//     depending on category. Streaming surface is shared by news flow,
//     symbol-page news, and the per-channel mediator (`streaming.channel`
//     hex id from /public/news-flow/v2/news?streaming=true).
//   - There is no per-event subscribe verb; the server pushes everything
//     attached to the channel after handshake.
//
// Worker constraints mirror pushstream: long-lived upstream WS lives in
// the StreamBridge Durable Object. This module supplies framing + URL
// helpers only; it does not own state.

const NOTIFICATIONS_WS = "wss://notifications.tradingview.com/news/channel";
const TV_ORIGIN = "https://www.tradingview.com";

export interface NewsStreamEvent {
  /** Channel name, when present in the envelope (e.g. mediator-issued hex id). */
  channel?: string;
  /** Event kind, e.g. `news`, `update`, `delete`. */
  kind: string;
  /** Story id when applicable. */
  id?: string;
  /** Symbols this news event is relevant to. */
  symbols?: string[];
  /** ISO timestamp of publication. */
  published?: string;
  /** Headline / title. */
  title?: string;
  /** Provider id and name when present. */
  provider?: { id?: string; name?: string };
  /** Full original payload for callers that need fidelity. */
  raw: any;
}

/**
 * Parse a notifications/news/channel frame into a NewsStreamEvent. Throws
 * on JSON failure; returns the parsed envelope so callers can drop or
 * forward as appropriate. The envelope shape varies — we accept several
 * observed variants and surface them via the `kind` discriminator.
 */
export const parseNewsFrame = (raw: string): NewsStreamEvent => {
  if (typeof raw !== "string" || raw.length === 0) {
    throw new Error("notifications frame is empty");
  }
  let data: any;
  try {
    data = JSON.parse(raw);
  } catch (err: any) {
    throw new Error(`notifications frame is not JSON: ${err?.message || err}`);
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("notifications frame must be a JSON object");
  }
  // Variant A: pushstream-style {channel, content} where content holds the news payload.
  if (typeof data.channel === "string" && data.content != null) {
    const inner = typeof data.content === "string" ? safeParseJson(data.content) : data.content;
    return {
      channel: data.channel,
      kind: typeof inner?.kind === "string" ? inner.kind : "news",
      id: extractStringId(inner),
      symbols: extractSymbols(inner),
      published: typeof inner?.published === "string" ? inner.published : undefined,
      title: typeof inner?.title === "string" ? inner.title : inner?.headline,
      provider: extractProvider(inner),
      raw: inner ?? data,
    };
  }
  // Variant B: direct news object {kind, item:{…}} or {kind, news_id,…}.
  return {
    kind: typeof data.kind === "string" ? data.kind : "news",
    id: extractStringId(data),
    symbols: extractSymbols(data),
    published: typeof data.published === "string" ? data.published : undefined,
    title: typeof data.title === "string" ? data.title : data?.headline,
    provider: extractProvider(data),
    raw: data,
  };
};

const safeParseJson = (text: string): any => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const extractStringId = (data: any): string | undefined => {
  if (!data || typeof data !== "object") return undefined;
  if (typeof data.id === "string") return data.id;
  if (typeof data.news_id === "string") return data.news_id;
  if (typeof data.storyId === "string") return data.storyId;
  if (data.item && typeof data.item.id === "string") return data.item.id;
  return undefined;
};

const extractSymbols = (data: any): string[] | undefined => {
  if (!data || typeof data !== "object") return undefined;
  if (Array.isArray(data.relatedSymbols)) {
    return data.relatedSymbols
      .map((s: any) => (typeof s === "string" ? s : s?.symbol))
      .filter((s: any): s is string => typeof s === "string");
  }
  if (Array.isArray(data.symbols)) {
    return data.symbols.filter((s: any): s is string => typeof s === "string");
  }
  if (data.item && Array.isArray(data.item.relatedSymbols)) {
    return data.item.relatedSymbols
      .map((s: any) => (typeof s === "string" ? s : s?.symbol))
      .filter((s: any): s is string => typeof s === "string");
  }
  return undefined;
};

const extractProvider = (data: any): { id?: string; name?: string } | undefined => {
  if (!data || typeof data !== "object") return undefined;
  const p = data.provider ?? data.item?.provider;
  if (!p || typeof p !== "object") return undefined;
  return {
    id: typeof p.id === "string" ? p.id : undefined,
    name: typeof p.name === "string" ? p.name : undefined,
  };
};

export interface NotificationsConnectOptions {
  sessionId?: string;
  sessionSign?: string;
  /** Optional symbol filter — kept on the Worker side; upstream pushes everything. */
  symbolFilter?: string[];
  /** Test seam. */
  webSocketImpl?: { new (url: string, protocols?: string[] | string): WebSocket };
}

export interface NotificationsHandlers {
  onEvent: (event: NewsStreamEvent) => void;
  onError?: (err: any) => void;
  onClose?: (code: number, reason: string) => void;
  onOpen?: () => void;
}

export interface NotificationsConnection {
  ws: WebSocket;
  url: string;
  close: (code?: number, reason?: string) => void;
}

export const buildNotificationsUrl = (): string => NOTIFICATIONS_WS;

export const buildNotificationsCookie = (
  sessionId: string,
  sessionSign?: string,
): string =>
  sessionSign ? `sessionid=${sessionId};sessionid_sign=${sessionSign}` : `sessionid=${sessionId}`;

export const buildNotificationsUpgradeHeaders = (
  sessionId?: string,
  sessionSign?: string,
): Record<string, string> => {
  const headers: Record<string, string> = {
    Upgrade: "websocket",
    Origin: TV_ORIGIN,
    "User-Agent":
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  };
  if (sessionId) headers.Cookie = buildNotificationsCookie(sessionId, sessionSign);
  return headers;
};

/** Open a notifications WebSocket and surface decoded news events. */
export const openNotifications = (
  opts: NotificationsConnectOptions,
  handlers: NotificationsHandlers,
): NotificationsConnection => {
  const url = buildNotificationsUrl();
  const Impl = opts.webSocketImpl ?? (globalThis as any).WebSocket;
  if (!Impl) throw new Error("WebSocket constructor not available");
  const ws = new Impl(url) as WebSocket;
  const filter = opts.symbolFilter && opts.symbolFilter.length > 0 ? new Set(opts.symbolFilter) : null;
  ws.addEventListener("message", (ev: any) => {
    try {
      const event = parseNewsFrame(typeof ev.data === "string" ? ev.data : String(ev.data));
      if (filter && event.symbols && event.symbols.length > 0) {
        const match = event.symbols.some((s) => filter.has(s));
        if (!match) return;
      }
      handlers.onEvent(event);
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
    close: (code = 1000, reason = "client_closed") => {
      try {
        ws.close(code, reason);
      } catch {
        /* ignore */
      }
    },
  };
};
