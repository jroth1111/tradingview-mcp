# TradingView Browser WebSocket Capture - 2026-05-07

## Status

- Bead: `tradingview-fkt`
- Capture mode: Playwright Chromium, clean context, no saved storage state
- Page: `https://www.tradingview.com/chart/?symbol=NASDAQ%3AAAPL`
- Result: document HTTP 200; chart title loaded; no browser error
- Working directory: `/Users/gwizz/CascadeProjects/Trading/tradingview`

This artifact complements the direct Node WebSocket probe by recording what the public browser chart page actually opens and sends without an authenticated session.

## Browser WebSocket Endpoints

| URL | Frames sent | Frames received | Notes |
| --- | ---: | ---: | --- |
| `wss://data.tradingview.com/socket.io/websocket?from=chart%2F&date=2026-05-06T09%3A00%3A22&type=chart&auth=sessionid` | 68 payloads / 68 decoded TradingView frames | 39 payloads / 187 decoded TradingView frames | active chart protocol |
| `wss://pushstream.tradingview.com/message-pipe-ws/public` | 0 | 0 | public message pipe opened but did not exchange frames during the 20 second capture |

The browser chart used `set_auth_token` with `unauthorized_user_token`, proving this was the no-session chart path.

## Browser-Sent Message Catalog

Observed sent message names:

- `set_auth_token`
- `set_locale`
- `chart_create_session`
- `quote_create_session`
- `quote_set_fields`
- `quote_add_symbols`
- `quote_fast_symbols`
- `quote_hibernate_all`
- `quote_remove_symbols`
- `resolve_symbol`
- `create_series`
- `modify_series`
- `remove_series`
- `create_study`
- `remove_study`
- `request_studies_metadata`
- `request_more_tickmarks`
- `set_future_tickmarks_mode`
- `switch_timezone`
- `chart_delete_session`

This expands the direct probe catalog with browser-only lifecycle and UI messages such as study creation/removal, quote hibernation, fast-symbol handling, tickmark requests, future tickmark mode, timezone switching, series modification/removal, and chart session deletion.

## Browser-Received Message Catalog

Observed received message names:

- `qsd`
- `quote_completed`
- `du`
- `symbol_resolved`
- `series_loading`
- `timescale_update`
- `series_timeframe`
- `series_completed`
- `studies_metadata`
- `study_loading`
- `study_completed`

The server also sent a session descriptor before normal `m/p` messages:

- session fragment: `charts-free`
- release: `release_209-727199`
- protocol: `json`
- `auth_scheme_vsn`: `2`

## Repo Comparison

`packages/tradingview-core/src/constants.ts` still only defines:

- `data`
- `prodata`
- `widgetdata`
- `charts-polygon`

Known gaps from the rediscovery artifacts:

- `history-data.tradingview.com` is live from direct probes and appears in public chart HTML for deep backtesting, but is absent from the endpoint constants.
- `pushstream.tradingview.com/message-pipe-ws/public` is a browser-opened public WebSocket surface, but is absent from endpoint constants and from the Worker raw-socket surface.
- Browser chart behavior uses more protocol messages than the current small direct probe and any implementation should avoid treating the direct candle probe as the full protocol envelope.

## Failure Classification

- No network, DNS, auth, rate-limit, or upstream failure occurred during this browser capture.
- `pushstream` had no frame traffic in the capture window; classify as observed-open-idle, not absent.

## Remaining Protocol Gaps

1. Replay UI capture and frame diff against this normal chart capture.
2. Deep backtesting UI capture, especially `history-data` browser usage and any strategy/backtest-specific messages.
3. Authenticated/pro behavior for `prodata`, `history-data`, and entitlement-specific fields.
4. Payload schema inventory for `du`, `studies_metadata`, `study_loading`, `study_completed`, and browser-created study parameters.
5. Intended trigger for `charts-polygon`; the direct probe failed for a generic chart shape, but no browser UI path has yet been used to exercise it.
