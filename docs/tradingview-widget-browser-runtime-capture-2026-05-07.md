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
| Scanner/body capture | second Chrome CDP pass on port 9224 with `Network.requestWillBeSent.request.postData` | screener and stock-heatmap scanner bodies plus technical-analysis field query captured | browser runtime body shape |
| Direct service probes | Node `fetch` to `chartevents-reuters` and Widget Sheriff routes | chart-events default returned HTTP 200 no-data JSON; Widget Sheriff success and missing-origin failure classified | direct public probe |
| Screener preset direct probes | Node `fetch` to `scanner.tradingview.com/{market}/scan?api_key=widget_user_token&label-product=screener-{type}-old` with widget-derived columns | representative forex, crypto, futures, crypto market, and bonds bodies returned populated public data; `preset:"general"` and bonds `Recommend.All` failures classified as invocation/field-shape misses | direct public probe |

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

#### Controlled PostMessage Probe

A follow-up clean Chrome CDP probe embedded `advanced-chart` in a parent page and captured parent `message` events while sending controlled iframe messages:

- Parent received `tv-widget-load` from `https://www.tradingview-widget.com`.
- Parent received `quoteUpdate` messages for the initial `BATS_DLY:AAPL` state.
- Sending `{ name: "set-symbol", data: { symbol: "NASDAQ:MSFT" } }` to the iframe switched subsequent `quoteUpdate` events to `BATS_DLY:MSFT`.
- Sending `{ name: "set-interval", data: { interval: "60" } }` produced no separately identified parent event in this short capture window.
- The probe did not capture widget WebSocket frames on the parent CDP target, so this proves the parent/iframe postMessage behavior and quote-update event schema, not the underlying socket delta for the symbol switch.

Classification: unauthenticated-achievable Advanced Chart parent message API for `set-symbol` and parent `quoteUpdate` events; `set-interval` remains partially classified because no distinct observable parent event was captured.

#### Controlled PostMessage Bundle Follow-Up

A deeper CDP attempt with child-target auto-attach still exposed only the parent and iframe document requests, not the iframe's subresource or socket traffic. That is a harness limitation, not evidence that no socket traffic exists.

The live iframe shell referenced `embed_advanced_chart.90731612c7a960eff2d6.js`. Temporary bundle extraction showed the runtime message helper:

- outgoing iframe-to-parent messages use `{ name, frameElementId, data }` through `window.parent.postMessage`.
- incoming parent-to-iframe control uses `window.addEventListener("message", ...)` and dispatches when `event.data.name` matches.
- `set-symbol` dispatches to `chartWidget.setSymbol(data.symbol)`.
- `set-interval` dispatches to `chartWidget.setResolution(data.interval)`.
- parent request/response helper methods also exist for `quoteSubscribe`, `imageCanvas`, `symbolInfo`, and `widgetReady`; `symbolInfo` replies with `{ name, exchange, description, type, interval }`.

Classification: Advanced Chart `set-interval` is bundle-verified as a public parent-to-iframe control that changes chart resolution. Its socket-frame delta remains unverified because the available CDP harness did not capture iframe subresources in the parent embed context.

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

- `POST scanner.tradingview.com/america/metainfo?api_key=widget_user_token&label-product=screener-stock-old` -> HTTP 200 with body `{"markets":["america"]}`.
- `POST scanner.tradingview.com/america/scan?api_key=widget_user_token&label-product=screener-stock-old` -> HTTP 200.
- No WebSocket opened during the capture window.
- Many symbol logo requests followed from `s3-symbol-logo.tradingview.com`, proving the rendered table had symbol rows, not just an empty shell.

Sanitized first-load scan body shape:

```json
{
  "filter": [
    {"left": "type", "operation": "in_range", "right": ["stock", "dr", "fund"]},
    {"left": "subtype", "operation": "in_range", "right": ["common", "foreign-issuer", "", "etf", "etf,odd", "etf,otc", "etf,cfd"]},
    {"left": "exchange", "operation": "in_range", "right": ["NYSE", "NASDAQ", "AMEX"]}
  ],
  "options": {"data_restrictions": "PREV_BAR", "lang": "en"},
  "markets": ["america"],
  "symbols": {"query": {"types": [], "exchanges": ["NASDAQ", "NYSE", "AMEX", "OTC"]}, "tickers": []},
  "columns": ["logoid", "name", "close", "change", "change_abs", "Recommend.All", "volume", "Value.Traded", "market_cap_basic", "price_earnings_ttm", "earnings_per_share_basic_ttm", "number_of_employees", "sector", "description", "type", "subtype", "update_mode", "pricescale", "minmov", "fractional", "minmove2", "currency", "fundamental_currency_code"],
  "sort": {"sortBy": "name", "sortOrder": "asc"},
  "range": [0, 150]
}
```

#### Screener Widget Product-Family Bodies

The public S3 embed script `embed-widget-screener.js` builds a `screener` iframe whose `locale`, `symbol`, and `market` are query parameters; the rest of the widget settings are hash JSON. The widget docs config exposes `market`, `defaultColumn`, and `defaultScreen`; the runtime screener bundle contains product families for stock, forex, crypto, crypto market, futures, continuous futures, CFDs, currencies, bonds, sectors, industries, pre-market, and post-market.

Direct public scanner probes using `api_key=widget_user_token` and widget-style `label-product=screener-{type}-old` returned populated data for representative non-stock widget families:

| Probe | Endpoint | Body traits | Result |
| --- | --- | --- | --- |
| Forex overview | `POST scanner.tradingview.com/forex/scan?api_key=widget_user_token&label-product=screener-forex-old` | `columns` included `name`, `close`, `change`, `bid`, `ask`, `high`, `low`, `Recommend.All`, `description`, `type`; `range:[0,10]`; `sortBy:name` | HTTP 200, `totalCount:6402`, first symbol `FX_IDC:AEDAUD` |
| Crypto overview | `POST scanner.tradingview.com/crypto/scan?api_key=widget_user_token&label-product=screener-crypto-old` | `columns` included `name`, `close`, `change`, `high`, `low`, `volume`, `24h_vol|5`, `24h_vol_change|5`, `Recommend.All`, `exchange`, `description` | HTTP 200, `totalCount:57085`, first symbol `COINBASE:00USD` |
| Futures overview | `POST scanner.tradingview.com/futures/scan?api_key=widget_user_token&label-product=screener-futures-old` | `columns` included `logoid`, `name`, `close`, `change`, `change_abs`, `high`, `low`, `Recommend.All`, `description` | HTTP 200, `totalCount:53587`, first symbol `CBOT_MINI:10Y1!` |
| Crypto market overview | `POST scanner.tradingview.com/crypto/scan?api_key=widget_user_token&label-product=screener-crypto_mkt-old` | `columns` included `base_currency_logoid`, `sector`, `market_cap_calc`, `market_cap_diluted_calc`, `close`, supply and traded-value fields | HTTP 200, `totalCount:57085`, first symbol `BYBIT:BTCUSD` |
| Bonds overview | `POST scanner.tradingview.com/bonds/scan?api_key=widget_user_token&label-product=screener-bonds-old` | `columns` included `logoid`, `name`, `coupon`, `maturity_date`, `close`, `change`, `change_abs`, `high`, `low`, `description` | HTTP 200, `totalCount:1145`, first symbol `TVC:AT01` |
| Bonds yield switch | same bonds endpoint | same columns plus `filter:[{left:"description",operation:"match",right:"YIELD$"}]` | HTTP 200, `totalCount:578`, first symbol `TVC:AT01Y` |
| Bonds non-yield switch | same bonds endpoint | same columns plus `filter:[{left:"description",operation:"nmatch",right:"YIELD$"}]` | HTTP 200, `totalCount:567`, first symbol `TVC:AT01` |

Two negative probes matter for robustness:

- Adding `preset:"general"` to these scanner bodies returned JSON 400 `preset not found: general`. The widget's `defaultScreen:"general"` is a UI/default-set setting, not a scanner API `preset` field for these direct bodies.
- Including `Recommend.All` in the bonds overview columns returned JSON 400 `Unknown field "Recommend.All"`. The live bonds scanner field set is narrower than the static overview table suggests; treat this as a field-shape mismatch, not auth, downgrade, or network failure.

### Stock Heatmap Widget

First-load stock heatmap runtime is also scanner-backed:

- `POST scanner.tradingview.com/america/scan?api_key=widget_user_token&label-product=heatmap-stock` -> HTTP 200.
- `widgetdata` opened but only exchanged session/heartbeat during the capture window.
- Large symbol logo fetch fan-out followed, consistent with populated heatmap tiles.

Sanitized first-load scan body shape:

```json
{
  "columns": ["typespecs", "change|60", "change|240", "change", "Perf.W", "Perf.1M", "Perf.3M", "Perf.6M", "Perf.YTD", "Perf.Y", "premarket_change", "postmarket_change", "relative_volume_10d_calc", "Volatility.D", "gap", "market_cap_basic", "volume", "volume|1W", "volume|1M", "Value.Traded", "Value.Traded|1W", "Value.Traded|1M", "sector", "sector.tr", "logo", "close|60", "pricescale", "name", "description", "update_mode"],
  "filter": [
    {"left": "is_blacklisted", "operation": "equal", "right": false},
    {"left": "name", "operation": "not_in_range", "right": ["GOOG"]},
    {"left": "market_cap_basic", "operation": "nempty"}
  ],
  "ignore_unknown_fields": false,
  "options": {"lang": "en", "data_restrictions": "PREV_BAR"},
  "sort": {"sortBy": "market_cap_basic", "sortOrder": "desc"},
  "symbols": {"symbolset": ["SYML:SP;SPX"]},
  "markets": ["america"]
}
```

### Technical Analysis Widget

Technical analysis first-load combines a `widgetdata` quote session with a scanner symbol metadata query:

- `GET scanner.tradingview.com/symbol?symbol=NASDAQ:AAPL&fields=...&no_404=true&label-product=external-widgets` -> HTTP 200.
- The captured `fields` set includes `Recommend.Other`, `Recommend.All`, `Recommend.MA`, oscillator fields (`RSI`, `Stoch.*`, `CCI20`, `ADX*`, `AO`, `Mom`, `MACD.*`), moving averages (`EMA10`, `SMA10`, through `EMA200`, `SMA200`), and pivot families (`Pivot.M.Classic.*`, `Fibonacci.*`, `Camarilla.*`, `Woodie.*`, `Demark.*`).

This proves the technical-analysis widget is not only quote-socket backed; it also uses a public scanner symbol endpoint with the `external-widgets` product label.

### Events Widget

Events widget runtime uses chart-events REST:

- `GET chartevents-reuters.tradingview.com/events?from=...&to=...&countries=...` was issued during first load.
- Public pushstream opened but stayed idle.
- A direct public probe of `GET /events?from=2026-05-01&to=2026-05-07&countries=us` returned HTTP 200 `application/json` with `{"status":"no_data"}`.
- Bundle extraction of `embed_events_widget.a24887de52eaaa77c397.js` showed the Reuters path is constructed with ISO timestamps from `new Date(...).toISOString()` and uppercase `countries`/`currencies`; lowercase date-only guesses are invocation-shape misses, not evidence of no data.
- A direct public probe of `GET /events?from=2026-05-01T00:00:00.000Z&to=2026-06-06T00:00:00.000Z&countries=US&minImportance=1` returned HTTP 200 `{"status":"ok"}` with 27 rows.

Populated event row fields observed across that response:

```json
{
  "actual": "number|null",
  "comment": "string",
  "country": "string",
  "currency": "string",
  "date": "ISO timestamp string",
  "forecast": "number|null",
  "id": "string",
  "importance": "number",
  "indicator": "string",
  "link": "string",
  "period": "string",
  "previous": "number|null",
  "scale": "string",
  "source": "string",
  "title": "string",
  "unit": "string"
}
```

Related-event history path from the same bundle: `GET ${ECONOMIC_CALENDAR_URL}related_events?eventId=...&countback=8`, returning `{status:"ok", result:[...]}` when available. That path is an economic-calendar host path, not the Reuters widget host.

Direct public probes with browser-like `Origin: https://www.tradingview-widget.com` and `Referer: https://www.tradingview-widget.com/embed-widget/events/?locale=en` classified the exact invocation requirements:

- `GET economic-calendar.tradingview.com/events?from=2026-05-01T00:00:00.000Z&to=2026-06-06T00:00:00.000Z&countries=US&minImportance=1` returned HTTP 200 `{"status":"ok"}` with 26 economic-calendar rows.
- Economic-calendar event ids are compact numeric strings such as `395677`, not the composite Reuters ids returned by `chartevents-reuters`.
- `GET economic-calendar.tradingview.com/related_events?eventId=395677&countback=8` returned HTTP 200 `{"status":"ok"}` with 10 rows.
- `GET economic-calendar.tradingview.com/related_events?eventId=398410&countback=8` returned HTTP 200 `{"status":"ok"}` with 9 rows.
- `GET economic-calendar.tradingview.com/related_events?eventId=not-a-real-event-id&countback=8` returned HTTP 400 JSON `{"status":"bad_request"}`.
- Missing browser-like `Origin` returned nginx HTML 403; valid `Origin` with a Reuters composite id returned JSON `bad_request`. Treat these as origin/id-shape invocation failures, not network outage or auth downgrade.

Related-event row fields observed across the successful probes:

```json
{
  "actual": "number|null",
  "actualRaw": "number|null",
  "category": "string",
  "comment": "string",
  "country": "string",
  "currency": "string",
  "date": "ISO timestamp string",
  "forecast": "number|null",
  "forecastRaw": "number|null",
  "id": "numeric string",
  "importance": "number",
  "indicator": "string",
  "period": "string",
  "previous": "number|null",
  "previousRaw": "number|null",
  "referenceDate": "ISO timestamp string",
  "source": "string",
  "source_url": "string",
  "ticker": "string",
  "title": "string",
  "unit": "string|absent"
}
```

### Widget Sheriff

Every captured widget issued:

- `GET widget-sheriff.tradingview-widget.com/sheriff/api/v1/rules/search?origin=https%3A%2F%2Fwww.tradingview-widget.com` -> HTTP 204.

Direct probes:

- `origin=https://example.com` -> HTTP 204.
- `origin=https://www.tradingview.com` -> HTTP 204.
- missing `origin` -> HTTP 400 JSON with validation message for required `SearchRequest.Origin`.
- `origin=https://www.tradingview-widget.com`, `https://www.tradingview.com`, `https://example.com`, `http://localhost:3000`, and `chrome-extension://abcdefghijklmnop` all returned HTTP 204.
- `origin=not a url` returned HTTP 400 JSON with validation message for the `url` tag.
- `origin=` and missing `origin` returned HTTP 400 JSON with validation message for the `required` tag.
- Extra unknown query parameter `widget=timeline` did not change the 204 success shape.
- `POST` and `OPTIONS` with a valid `origin` returned HTML 403 from the edge/proxy layer.

This classifies Widget Sheriff as a public GET-only policy/availability check whose normal no-rule success is `204 No Content`; missing or malformed `origin` is validation failure, non-GET is method/edge rejection, and none of these outcomes imply auth or network downgrade.

### Timeline Widget

Timeline first-load did not issue a news-mediator request in the captured window. It loaded widget bundles, logo assets, Widget Sheriff, and telemetry.

A follow-up shell and bundle probe resolved the first-load ambiguity:

- `GET https://www.tradingview-widget.com/embed-widget/timeline/?locale=en` returned HTTP 200 with an inline `<script type="application/prs.init-data+json">` block.
- That init-data block contained 15 `news` rows under a generated root key.
- Observed news row fields: `id`, `link`, `provider`, `published`, `relatedSymbols`, `storyPath`, `title`, and `urgency`.
- Observed `provider` fields: `id`, `logo_id`, and `name`.
- Observed `relatedSymbols` fields: `symbol`, `logoid`, `currency-logoid`, and `base-currency-logoid`.
- Downloaded timeline runtime bundles included `runtime-embed_timeline_widget.c03c6e0d78c5ae674251.js`, `32387.47ace83c61a884341cd6.js`, `998.98a265cc760e9aa4c867.js`, and `embed_timeline_widget.fe1f3bc4975af39db28c.js`.
- `embed_timeline_widget.fe1f3bc4975af39db28c.js` parses `application/prs.init-data+json`, hydrates from `window.initData`, renders the `news` rows, and builds article links plus a `/news/` "Keep reading" link with UTM parameters.

This classifies the timeline widget first-load shape as server-rendered / init-data-backed, not as a missing first-load XHR. A longer interaction capture is still useful only for detecting optional later pagination, refresh, or filtered-news behavior.

## Failure Classification

| Observation | Classification | Handling |
| --- | --- | --- |
| No Playwright/Puppeteer dependency in repo | environment/tooling constraint | Used Chrome DevTools Protocol directly; no dependency install required |
| Timeline had no news XHR in first-load capture | SSR/init-data backed first-load | Shell and bundle probe proved inline `application/prs.init-data+json` news rows; keep later-interaction pagination/filtering open |
| Events `chartevents` request status was not recorded in reduced summary | capture timing/partial evidence | Direct probes now prove HTTP 200 no-data envelope, populated Reuters schema, and populated economic-calendar related-history schema |
| `related_events` without browser-like `Origin` returned nginx HTML 403 | origin-gated invocation | Retry with widget/browser `Origin` and `Referer`; do not classify as auth or network |
| Reuters composite event id on `related_events` returned JSON `bad_request` | id-shape invocation failure | Use numeric event ids from `economic-calendar.tradingview.com/events`, not Reuters composite ids |
| Widget Sheriff valid URL origins returned 204 while malformed/missing origins returned structured 400 | validation semantics | Treat 204 as no-rule success and 400 as input validation, not policy denial |
| Widget Sheriff `POST`/`OPTIONS` returned HTML 403 | method/edge rejection | Use GET with `origin`; do not infer auth requirement |
| Public pushstream opened but stayed idle | observed-open-idle | Needs channel trigger; do not treat as absence |
| Stock heatmap widgetdata carried only session/heartbeat while data came from scanner | partial-availability / mixed transport | Model heatmap as scanner-backed with optional/idle widgetdata in first-load context |

No auth, rate-limit, or network outage was observed in this pass.

## Worker Gap Update

Representative widget runtime now proves these missing or indirect Worker families:

- Widget metadata/catalog route for docs, script versions, iframe IDs, and supported config presets.
- Widget Sheriff check surface and its 204 success semantics.
- `widgetdata` WebSocket session modeling for widget contexts using `widget_user_token`.
- Widget-specific scanner bodies for screener and heatmap widgets, including representative stock, forex, crypto, crypto market, futures, bonds, and bond yield-switch bodies.
- Chart-events Reuters feed and economic-calendar related-history feed for events widget.
- Advanced Chart, Market Overview, Symbol Info, and Technical Analysis quote/session frame templates.
- Advanced Chart parent/iframe `postMessage` control and `quoteUpdate` event schema for a public `set-symbol` change, plus bundle-verified `set-interval -> setResolution` behavior.
- Public pushstream open-idle behavior for widgets that subscribe without a private channel.

Existing Worker primitives overlap with parts of this behavior (`quotes`, generic `scan`, chart WebSocket framing, calendars/news), but there is still no first-class widget/embed model or documented mapping from widget config to Worker calls.

## Remaining Widget Gaps

- Advanced Chart postMessage socket-frame deltas after `set-symbol`/`set-interval`; parent event behavior and interval handler semantics are now proven or bundle-verified.
- Longer timeline/news interaction capture only for optional pagination/filtering beyond the proven SSR/init-data first-load rows.
- Additional widget-specific scanner interaction bodies beyond representative first-load/default family bodies: saved views, toolbar changes, custom filters, column changes, and sort/filter UI events.
- Worker design decision: first-class `/v1/widgets/*` metadata/runtime routes vs mapping widgets onto existing scanner/chart/news/calendar primitives.

## Completion Decision

The widget/browser-runtime subfront is partially verified and materially advanced. Representative public browser runtime evidence now exists for eight widget families, including live WebSocket and XHR surfaces. The broader full TradingView rediscovery objective remains incomplete because authenticated, mutation, replay/deep-backtesting, macro-map interaction, mobile/desktop, and several widget interaction/schema probes remain open.
