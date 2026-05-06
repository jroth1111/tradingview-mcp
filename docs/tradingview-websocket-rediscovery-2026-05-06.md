# TradingView WebSocket Rediscovery - 2026-05-06

## Status

- Bead: `tradingview-fkt`
- Parent context: `docs/tradingview-surface-rediscovery-2026-05-06.md`
- Evidence timestamp: `2026-05-06T20:43Z`
- Scope covered: direct unauthenticated WebSocket probes for chart/quote/candle behavior on public endpoints
- Browser chart capture: `docs/tradingview-browser-websocket-capture-2026-05-07.md`
- Scope not yet covered: browser-captured replay UI, deep backtesting UI, authenticated/pro plan behavior, and full payload schema capture

This is a protocol checkpoint, not final completion of the WebSocket rediscovery bead.

## Repo Baseline

`packages/tradingview-core/src/constants.ts` currently defines:

- `data`: `wss://data.tradingview.com/socket.io/websocket`
- `prodata`: `wss://prodata.tradingview.com/socket.io/websocket`
- `widgetdata`: `wss://widgetdata.tradingview.com/socket.io/websocket`
- `charts-polygon`: `wss://charts-polygon.tradingview.com/socket.io/websocket`

`worker/src/tv-raw-socket.ts` implements a raw WebSocket client with:

- browser-like `Origin` and `User-Agent`
- optional `sessionid` and `sessionid_sign` cookies
- standard WebSocket upgrade validation
- masked client frames
- server ping handling
- text frame delivery

The browser capture adds one more observed public WebSocket endpoint not modeled by the core constants or Worker raw-socket surface:

- `pushstream.tradingview.com/message-pipe-ws/public`

## Live Endpoint Probes

The probe used Node's built-in `WebSocket` and sent these TradingView messages:

- `set_auth_token` with `unauthorized_user_token`
- `chart_create_session`
- `quote_create_session`
- `quote_add_symbols` for `NASDAQ:AAPL`
- `resolve_symbol` for `NASDAQ:AAPL`
- `create_series` for `1D`, 5 bars

| Endpoint | Result | Observed server/session evidence | Observed message names |
| --- | --- | --- | --- |
| `wss://data.tradingview.com/socket.io/websocket?...type=chart` | opened and returned data | `charts-free`, release `release_209-727199`, protocol `json`, `auth_scheme_vsn: 2` | `series_loading`, `qsd`, `symbol_resolved`, `quote_completed`, `timescale_update`, `series_completed` |
| `wss://prodata.tradingview.com/socket.io/websocket?...type=chart` | opened and returned data | `charts-pro`, release `release_209-727199`, protocol `json`, `auth_scheme_vsn: 2` | `series_loading`, `symbol_resolved`, `qsd`, `timescale_update`, `series_completed`, `quote_completed` |
| `wss://history-data.tradingview.com/socket.io/websocket?...type=chart` | opened and returned data | `charts-history`, release `release_209-727199`, protocol `json`, `auth_scheme_vsn: 2` | `series_loading`, `symbol_resolved`, `qsd`, `quote_completed`, `timescale_update`, `series_completed` |
| `wss://widgetdata.tradingview.com/socket.io/websocket?...` | opened and returned data | `charts-wgt`, release `release_209-727199`, protocol `json`, `auth_scheme_vsn: 2` | `series_loading`, `symbol_resolved`, `qsd`, `quote_completed`, `timescale_update`, `series_completed` |
| `wss://charts-polygon.tradingview.com/socket.io/websocket?...type=chart` | failed to open | WebSocket error then close code `1006` | none |

No DNS outage was observed in this pass. `charts-polygon` is a runtime/protocol failure for this probe shape, not proof that the host is absent.

## Rediscovered Protocol Facts

- The first server text message can be a JSON session descriptor rather than an `m/p` message.
- Session descriptors include `session_id`, `timestamp`, `timestampMs`, `release`, `studies_metadata_hash`, `auth_scheme_vsn`, `protocol`, `via`, and `javastudies`.
- `history-data.tradingview.com` is a live WebSocket host for unauthenticated chart/quote/candle probes and returns a `charts-history` session.
- The same basic chart-session/quote-session message set works on `data`, `prodata`, `history-data`, and `widgetdata`.
- `qsd` quote messages carry an object with at least `n`, `s`, and `v` keys.
- `timescale_update` payloads are keyed by the requested series id, for example `sds_1`.
- `series_completed` and `quote_completed` mark finite response completion for this small candle/quote probe.
- A no-session browser chart opens `data.tradingview.com` with `set_auth_token` `unauthorized_user_token`, and also opens idle public pushstream at `pushstream.tradingview.com/message-pipe-ws/public`.
- Browser chart startup sends additional lifecycle/UI messages beyond the direct probe: `set_locale`, `quote_set_fields`, `quote_fast_symbols`, `quote_hibernate_all`, `quote_remove_symbols`, `modify_series`, `remove_series`, `create_study`, `remove_study`, `request_studies_metadata`, `request_more_tickmarks`, `set_future_tickmarks_mode`, `switch_timezone`, and `chart_delete_session`.
- Browser chart startup receives additional messages beyond the direct probe: `du`, `series_timeframe`, `studies_metadata`, `study_loading`, and `study_completed`.

## Repo Gap

`history-data.tradingview.com` appears in public chart HTML as `window.WEBSOCKET_HOST_FOR_DEEP_BACKTESTING` and succeeded in live protocol probing, but it is absent from `TradingviewEndpoint` and `TRADINGVIEW_WS_ENDPOINTS`.

`pushstream.tradingview.com/message-pipe-ws/public` was opened by the public chart page in a clean browser context, but it is also absent from `TradingviewEndpoint` and `TRADINGVIEW_WS_ENDPOINTS`.

These should become Worker/core implementation items only after deciding how to expose endpoint selection without weakening the current API contract. At minimum, future protocol code should treat `history-data` and public pushstream as known endpoint families rather than unknown leads.

## Next Protocol Probes

1. Browser-capture deep backtesting UI and confirm whether it uses `history-data` with the same frame envelope or additional messages.
2. Browser-capture replay UI and compare its frame names to the normal browser chart capture.
3. Capture authenticated/pro behavior for `prodata` and `history-data`; unauth success does not prove entitlement-specific behavior.
4. Reprobe `charts-polygon` with its intended UI trigger or symbol class before removing or downgrading it.
5. Expand message catalog by exercising `request_more_data`, replay/deep-backtesting controls, and authenticated/pro-only study output.

## Acceptance Holes

Negative-probe hole: direct unauthenticated probes can pass while browser-only replay/deep-backtesting flows use additional hidden messages. This checkpoint cannot prove those flows complete.

Positive-probe hole: message names are cataloged, but full payload schemas are summarized only by top-level keys. A schema-grade artifact still requires payload redaction and field inventory.
