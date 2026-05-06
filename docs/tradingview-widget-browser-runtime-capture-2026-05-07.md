# TradingView Widget Browser Runtime Capture - 2026-05-07

## Status

- Bead: `tradingview-cef`
- Mode: public unauthenticated browser runtime capture through Chrome DevTools Protocol
- Task class: planned multi-item research checkpoint, documentation artifact only
- Source requirement: continue rediscovering TradingView widget/embed surfaces beyond shell/static evidence, without downgrading network, invocation, or route-discovery failures
- Capture workspace: `/tmp/tv-widget-cdp.wtHDlq/capture`
- Sensitive inputs: none used; no cookies, JWTs, session IDs, or account-specific payloads were supplied or committed

This pass browser-loaded representative public iframe widgets and captured real request, response, and WebSocket evidence. It upgrades widgets/embeds from "public iframe shell + bundle evidence" to "public browser runtime transport observed" for eight representative widget families.

## Probe Record

| Probe | Command / source | Result | Evidence level |
| --- | --- | --- | --- |
| Headless Chrome CDP launch | `Google Chrome --headless=new --remote-debugging-port=9223 --user-data-dir=/tmp/tv-widget-cdp.wtHDlq/profile` | Chrome launched with temporary profile | local browser runtime |
| CDP network capture | Node script using Chrome `/json/new`, `Network.enable`, `Page.navigate`, `Network.webSocket*` events | eight widget pages captured | browser runtime |
| Cleanup | `kill -TERM 40707; sleep 2; pgrep -laf 'remote-debugging-port=9223|tv-widget-cdp.wtHDlq'` | no Chrome process remained for the temp profile | local cleanup |
| Validation input | `/tmp/tv-widget-cdp.wtHDlq/capture/summary.json` plus per-widget JSON | summarized into this artifact; raw temp files not committed | sanitized derived evidence |

Counterexample shown: if widget runtime were assumed to be static HTML plus external-embedding JS, this capture disproves that by showing live `widgetdata` WebSocket sessions, scanner XHR, Widget Sheriff requests, chart-events REST, support portal fetches, logo/CDN fetches, and public pushstream connections during first-load widget rendering.

## Captured Widgets

| Widget | Requests | Key hosts | WebSocket evidence |
| --- | ---: | --- | --- |
| `advanced-chart` | 261 | `www.tradingview-widget.com`, `s3.tradingview.com`, `scanner-backend.tradingview.com`, `www.tradingview.com`, `widget-sheriff.tradingview-widget.com`, `s3-symbol-logo.tradingview.com` | `widgetdata` sent 29 frames / received 12 frames; public `pushstream` opened idle |
| `screener` | 196 | `www.tradingview-widget.com`, `widget-sheriff.tradingview-widget.com`, `scanner.tradingview.com`, `snowplow-pixel.tradingview.com`, `s3-symbol-logo.tradingview.com` | none |
| `stock-heatmap` | 140 | `www.tradingview-widget.com`, `widget-sheriff.tradingview-widget.com`, `scanner.tradingview.com`, `s3-symbol-logo.tradingview.com` | `widgetdata` sent 1 heartbeat / received session and heartbeat |
| `market-overview` | 48 | `www.tradingview-widget.com`, `widget-sheriff.tradingview-widget.com`, `s3-symbol-logo.tradingview.com` | `widgetdata` sent 15 frames / received 6 frames |
| `timeline` | 44 | `www.tradingview-widget.com`, `widget-sheriff.tradingview-widget.com`, `snowplow-pixel.tradingview.com`, `s3-symbol-logo.tradingview.com` | none |
| `events` | 47 | `www.tradingview-widget.com`, `widget-sheriff.tradingview-widget.com`, `chartevents-reuters.tradingview.com`, `snowplow-pixel.tradingview.com`, `s3-symbol-logo.tradingview.com` | public `pushstream` opened idle |
| `technical-analysis` | 39 | `www.tradingview-widget.com`, `widget-sheriff.tradingview-widget.com`, `scanner.tradingview.com` | `widgetdata` sent 9 frames / received 2 frames |
| `symbol-info` | 32 | `www.tradingview-widget.com`, `widget-sheriff.tradingview-widget.com`, `s3-symbol-logo.tradingview.com` | `widgetdata` sent 14 frames / received 5 frames |

## Runtime Hosts And Routes

Observed public first-load host/path families:

| Host | Observed route shape | Widgets | Classification |
| --- | --- | --- | --- |
| `www.tradingview-widget.com` | `/embed-widget/{id}/`, `/static/bundles/embed/*.css`, `/static/bundles/embed/*.js` | all captured widgets | public shell and bundle host |
| `widget-sheriff.tradingview-widget.com` | `GET /sheriff/api/v1/rules/search?origin=...` -> HTTP 204 | all captured widgets | public policy/availability check |
| `widgetdata.tradingview.com` | `wss://widgetdata.tradingview.com/socket.io/websocket?from=embed-widget/{id}/&date=...` | advanced-chart, stock-heatmap, market-overview, technical-analysis, symbol-info | public widget WebSocket |
| `pushstream.tradingview.com` | `wss://pushstream.tradingview.com/message-pipe-ws/public` | advanced-chart, events | public open-idle stream |
| `scanner.tradingview.com` | `POST /america/metainfo?api_key&label-product=...`; `POST /america/scan?api_key&label-product=...`; `GET /symbol?symbol&fields&no_404&label-product=...` | screener, stock-heatmap, technical-analysis | public scanner and symbol metadata |
| `scanner-backend.tradingview.com` | `GET /enum/ordered?id=...&lang=...&label-product=...` | advanced-chart | public enum metadata |
| `chartevents-reuters.tradingview.com` | `GET /events?from=...&to=...&countries=...` | events | public chart-events feed |
| `www.tradingview.com` | `GET /support/support-portal-problems/?language=...` | advanced-chart | public support metadata fetch |
| `s3.tradingview.com` | `GET /conversions_en.json` | advanced-chart | public static conversion metadata |
| `s3-symbol-logo.tradingview.com` | symbol/source/country logo SVGs | many widgets | public asset host |
| `snowplow-pixel.tradingview.com` | `POST /com.tradingview/track` plus CORS preflight where needed | screener, timeline, events | telemetry; not Worker business data |

## WebSocket Frame Shapes

The `widgetdata` widgets use the same `~m~<length>~m~<json>` framing family already observed in chart WebSocket probes, but with widget-specific tokens and session names.

### Advanced Chart

Sent frame methods included:

- `set_data_quality` with `low`
- `set_auth_token` with `widget_user_token`
- `set_locale`
- `chart_create_session`
- `quote_create_session`

Received frame methods included:

- connection/session metadata with `release`, `studies_metadata_hash`, `auth_scheme_vsn`, and `protocol`
- `qsd` quote snapshots for `NASDAQ:AAPL` and resolved variants
- a large `studies_metadata` payload

The same page also opened `wss://pushstream.tradingview.com/message-pipe-ws/public`, but no frames arrived during the capture window. Preserve this as public open-idle stream evidence, not absence of pushstream behavior.

### Market Overview

Sent frame methods included:

- `set_data_quality`
- `set_auth_token` with `widget_user_token`
- `set_locale`
- `chart_create_session` with `disable_statistics`
- `switch_timezone`

Received frame methods included:

- session metadata
- `series_loading`
- `symbol_resolved`
- `qsd` quote snapshots for configured market symbols such as FOREX.com index symbols
- heartbeat

### Symbol Info

Sent frame methods included:

- `set_data_quality`
- `set_auth_token` with `widget_user_token`
- `set_locale`
- `quote_create_session`
- `quote_set_fields` with a large simple-detail field list

Received frame methods included:

- session metadata
- `qsd` snapshots for `NASDAQ:AAPL`, including bid/ask and detailed quote fields
- heartbeat

### Technical Analysis

Sent frame methods included:

- `set_data_quality`
- `set_auth_token` with `widget_user_token`
- `set_locale`
- `quote_create_session`
- `quote_set_fields`

Received frame methods included:

- session metadata
- `qsd` quote snapshot for `NASDAQ:AAPL`

The page also issued `GET scanner.tradingview.com/symbol?symbol=...&fields=...&no_404=...&label-product=...`.

### Stock Heatmap

Runtime traffic combined scanner REST with a mostly-idle widgetdata socket:

- `POST scanner.tradingview.com/america/scan?api_key=...&label-product=...` returned HTTP 200.
- `widgetdata` opened and exchanged heartbeat/session metadata only in the capture window.

This is a partial-availability case: heatmap data came from scanner REST, while the socket remained available but did not carry the primary heatmap payload during this first-load probe.

## REST/XHR Widget Findings

### Screener Widget

First-load screener runtime is REST scanner-backed:

- `POST scanner.tradingview.com/america/metainfo?api_key=...&label-product=...` -> HTTP 200.
- `POST scanner.tradingview.com/america/scan?api_key=...&label-product=...` -> HTTP 200.
- No WebSocket opened during the capture window.
- Many symbol logo requests followed from `s3-symbol-logo.tradingview.com`, proving the rendered table had symbol rows, not just an empty shell.

### Stock Heatmap Widget

First-load stock heatmap runtime is also scanner-backed:

- `POST scanner.tradingview.com/america/scan?api_key=...&label-product=...` -> HTTP 200.
- `widgetdata` opened but only exchanged session/heartbeat during the capture window.
- Large symbol logo fetch fan-out followed, consistent with populated heatmap tiles.

### Events Widget

Events widget runtime uses chart-events REST:

- `GET chartevents-reuters.tradingview.com/events?from=...&to=...&countries=...` was issued during first load.
- Public pushstream opened but stayed idle.
- Treat the missing recorded status in this CDP summary as capture truncation/response-timing uncertainty, not failure; the request itself is live browser evidence and needs a targeted direct probe for response schema.

### Timeline Widget

Timeline first-load did not issue a news-mediator request in the captured window. It loaded widget bundles, logo assets, Widget Sheriff, and telemetry. This is a weakly verified runtime shape: either the embedded bundle contains a preloaded/news snapshot path not captured as XHR, the first-load config did not trigger network news fetch in the capture window, or a later scroll/interaction is required.

Do not call the timeline/news feed absent. The next probe is a longer runtime capture with scroll/resize or bundle request-builder extraction for `embed_timeline_widget`.

## Failure Classification

| Observation | Classification | Handling |
| --- | --- | --- |
| No Playwright/Puppeteer dependency in repo | environment/tooling constraint | Used Chrome DevTools Protocol directly; no dependency install required |
| Timeline had no news XHR in first-load capture | partial/trigger uncertainty | Keep open; do longer interaction capture or bundle request-builder extraction |
| Events `chartevents` request status was not recorded in reduced summary | capture timing/partial evidence | Run targeted direct probe before claiming schema; do not downgrade endpoint |
| Public pushstream opened but stayed idle | observed-open-idle | Needs channel trigger; do not treat as absence |
| Stock heatmap widgetdata carried only session/heartbeat while data came from scanner | partial-availability / mixed transport | Model heatmap as scanner-backed with optional/idle widgetdata in first-load context |

No auth, rate-limit, or network outage was observed in this pass.

## Worker Gap Update

Representative widget runtime now proves these missing or indirect Worker families:

- Widget metadata/catalog route for docs, script versions, iframe IDs, and supported config presets.
- Widget Sheriff check surface and its 204 success semantics.
- `widgetdata` WebSocket session modeling for widget contexts using `widget_user_token`.
- Widget-specific scanner presets for screener and heatmap widgets.
- Chart-events Reuters feed for events widget.
- Advanced Chart, Market Overview, Symbol Info, and Technical Analysis quote/session frame templates.
- Public pushstream open-idle behavior for widgets that subscribe without a private channel.

Existing Worker primitives overlap with parts of this behavior (`quotes`, generic `scan`, chart WebSocket framing, calendars/news), but there is still no first-class widget/embed model or documented mapping from widget config to Worker calls.

## Remaining Widget Gaps

- Controlled Advanced Chart `postMessage` interaction: `set-symbol`, `set-interval`, and parent event capture.
- Longer timeline/news interaction capture or decompiled request-builder proof.
- Direct chart-events response schema probe for events widget.
- Widget Sheriff parameter exploration and negative cases.
- Widget-specific scanner body capture with sanitized request bodies, not just host/path/method.
- Worker design decision: first-class `/v1/widgets/*` metadata/runtime routes vs mapping widgets onto existing scanner/chart/news/calendar primitives.

## Completion Decision

The widget/browser-runtime subfront is partially verified and materially advanced. Representative public browser runtime evidence now exists for eight widget families, including live WebSocket and XHR surfaces. The broader full TradingView rediscovery objective remains incomplete because authenticated, mutation, replay/deep-backtesting, macro-map interaction, mobile/desktop, and several widget interaction/schema probes remain open.
