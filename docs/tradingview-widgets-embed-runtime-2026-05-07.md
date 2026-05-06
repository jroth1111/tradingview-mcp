# TradingView Widgets And Embed Runtime - 2026-05-07

## Status

- Bead: `tradingview-cef`
- Mode: public unauthenticated widget docs, script, iframe, and bundle-entry discovery
- Task class: planned multi-item research checkpoint, documentation artifact only
- Source requirement: rediscover visible and invisible TradingView surfaces, including unknown unknowns, and do not downgrade a surface because of invocation, route-guess, or network failures
- Temp workspace: `/tmp/tv-widgets.4XxPAM`
- Sensitive inputs: none used in this pass

This pass upgrades widgets/embeds from static route leads to live public runtime evidence. It does not claim exhaustive request-schema coverage for every interactive widget state; it records the first-class docs/routes/scripts/iframe shells and the host/entry-script surfaces to use for the next capture wave.

Follow-up browser runtime capture: `docs/tradingview-widget-browser-runtime-capture-2026-05-07.md` promotes representative widgets from shell/bundle evidence to live XHR/WebSocket evidence.

## Probe Record

| Probe | Source / command class | Result | Evidence level |
| --- | --- | --- | --- |
| Widget docs fetch | Node `fetch` against `www.tradingview.com/widget-docs/` and selected docs routes | docs index and sampled canonical routes returned HTTP 200 | live public |
| Canonical docs route extraction | HTML route extraction from widget docs index | 40+ widget docs and demo routes recovered | live public + static HTML |
| External embedding script fetch | `s3.tradingview.com/external-embedding/embed-widget-*.js` and `tv.js` | 9 docs-linked scripts returned HTTP 200 | live public script |
| Common embed script HEAD probes | guessed `embed-widget-{id}.js` names on S3 | 19 common widget scripts returned HTTP 200; one guessed script name returned 403 | live public route-probe |
| Widget iframe shell fetch | `https://www.tradingview-widget.com/embed-widget/{id}/` for 19 widget IDs | all returned HTTP 200 HTML shells | live public iframe |
| Browser runtime capture | Chrome DevTools Protocol against eight representative widgets | real scanner XHR, Widget Sheriff fetches, chart-events request, `widgetdata` WebSockets, and public pushstream open-idle captured | browser runtime |
| Iframe runtime globals | extraction from iframe HTML | widgetdata WebSocket, sheriff, symbol search, scanner, calendar, news, Pine, pushstream, and CRUD hosts identified | live public + static runtime |
| Entry bundle fetch | iframe-referenced `static.tradingview.com/static/bundles/*` scripts | all referenced runtime and entry bundles returned HTTP 200 | live public script |
| Entry bundle string mining | `rg` over downloaded entry bundles | screener product families, advanced-chart postMessage API, analysis view registry, and widget lifecycle events found | static bundle |

Counterexample shown: if widget coverage were limited to the old chart-page route-pattern list, this pass would fail that model by proving a separate docs route tree, S3 external-embedding scripts, `tradingview-widget.com/embed-widget/*` iframe shells, and widget-specific runtime globals. If route guesses are treated as absence, the 404/403 route-miss cases below show how a valid widget family can be hidden behind a different canonical path or object name.

## Canonical Widget Docs Routes

The widget docs index exposes these first-class widget families and demos:

| Family | Canonical routes observed |
| --- | --- |
| Brokers | `/widget-docs/widgets/brokers/rating`, `/widget-docs/widgets/brokers/reviews` |
| Calendars | `/widget-docs/widgets/calendars/economic-calendar` |
| Charts | `/widget-docs/widgets/charts/advanced-chart`, demos for analytics-platform, basic-area-chart, technical-analysis, watchlist; `/widget-docs/widgets/charts/legacy-mini-chart/`; `/widget-docs/widgets/charts/mini-chart`; `/widget-docs/widgets/charts/symbol-overview`, demos for compare, indices-overview, technical-chart, vertical-chart |
| Economics | `/widget-docs/widgets/economics/economic-map` |
| Heatmaps | `/widget-docs/widgets/heatmaps/crypto-heatmap`, `/etf-heatmap`, `/forex-cross-rates`, `/forex-heatmap`, `/stock-heatmap`, plus stock demos for relative-volume and YTD performance |
| News | `/widget-docs/widgets/news/top-stories` |
| Screeners | `/widget-docs/widgets/screeners/crypto-mkt-screener`, `/screeners/screener`, demos for crypto-pairs, forex, stock |
| Symbol details | `/widget-docs/widgets/symbol-details/company-profile`, `/fundamental-data`, `/symbol-info`, `/technical-analysis`, plus technical-analysis multiple/single demos |
| Tickers | `/widget-docs/widgets/tickers/single-ticker`, `/ticker`, `/ticker-tag`, `/ticker-tape`, plus ticker-tape gallery |
| Watchlists | `/widget-docs/widgets/watchlists/market-overview`, `/market-quotes`, `/market-summary`, `/stock-market`, plus demos for crypto, forex, futures, indices, stock, Brazil exchange, customized stock widget, and no-chart |

The docs pages also expose these reusable hosts and assets:

- `https://s3.tradingview.com/tv.js`
- `https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js`
- `https://s3.tradingview.com/external-embedding/embed-widget-events.js`
- `https://s3.tradingview.com/external-embedding/embed-widget-forex-cross-rates.js`
- `https://s3.tradingview.com/external-embedding/embed-widget-screener.js`
- `https://s3.tradingview.com/external-embedding/embed-widget-single-quote.js`
- `https://s3.tradingview.com/external-embedding/embed-widget-symbol-overview.js`
- `https://s3.tradingview.com/external-embedding/embed-widget-tickers.js`
- `https://s3.tradingview.com/external-embedding/embed-widget-timeline.js`
- `https://widgets.tradingview-widget.com`
- `https://www.tradingview.com/widget/`
- `https://s3.tradingview.com/conversions_en.json`
- `https://s3-symbol-logo.tradingview.com/`

## Public Embed Iframe Shells

Direct no-cookie iframe shell fetches returned HTTP 200 HTML for these widget IDs:

| Widget ID | HTTP | Bytes | Classification |
| --- | ---: | ---: | --- |
| `advanced-chart` | 200 | 73001 | public iframe shell |
| `symbol-overview` | 200 | 43897 | public iframe shell |
| `tickers` | 200 | 45157 | public iframe shell |
| `ticker-tape` | 200 | 45202 | public iframe shell |
| `single-quote` | 200 | 45195 | public iframe shell |
| `screener` | 200 | 31518 | public iframe shell |
| `forex-cross-rates` | 200 | 44592 | public iframe shell |
| `events` | 200 | 28946 | public iframe shell |
| `timeline` | 200 | 49529 | public iframe shell |
| `stock-heatmap` | 200 | 46909 | public iframe shell |
| `crypto-coins-heatmap` | 200 | 46926 | public iframe shell |
| `etf-heatmap` | 200 | 46877 | public iframe shell |
| `forex-heat-map` | 200 | 42643 | public iframe shell |
| `market-overview` | 200 | 48691 | public iframe shell |
| `market-quotes` | 200 | 45799 | public iframe shell |
| `symbol-info` | 200 | 52609 | public iframe shell |
| `technical-analysis` | 200 | 45631 | public iframe shell |
| `financials` | 200 | 44543 | public iframe shell |
| `symbol-profile` | 200 | 26841 | public iframe shell |

This promotes the widget family from "static route lead" to "public unauthenticated shell available" for the probed IDs.

## Runtime Host Matrix

Most iframe shells declare the same widget runtime host set:

| Host / global | Role |
| --- | --- |
| `WEBSOCKET_HOST=widgetdata.tradingview.com` | widget chart/quote/candle WebSocket data |
| `WEBSOCKET_HOST_FOR_RECONNECT=widgetdata-backup.tradingview.com` | backup widgetdata WebSocket host |
| `S3_LOGO_SERVICE_BASE_URL=https://s3-symbol-logo.tradingview.com/` | symbol logos |
| `SS_HOST=symbol-search.tradingview.com` | symbol search |
| `WIDGET_SHERIFF_HOST=https://widget-sheriff.tradingview-widget.com` | widget availability/policy service |
| `S3_NEWS_IMAGE_SERVICE_BASE_URL=https://s3.tradingview.com/news/` | news images |
| `WEBPACK_STATIC_PATH=https://static.tradingview.com/static/bundles/` | entry/runtime bundles |
| `CRUD_STORAGE_URL=https://crud-storage.tradingview.com` | persisted widget/chart state lead |

Widget-specific additions:

| Widget | Additional globals / hosts |
| --- | --- |
| `advanced-chart` | `PINE_URL=https://pine-facade.tradingview.com/pine-facade`, `PUSHSTREAM_URL=wss://pushstream.tradingview.com`, `CHARTEVENTS_URL=https://chartevents-reuters.tradingview.com/`, `ECONOMIC_CALENDAR_URL=https://economic-calendar.tradingview.com/`, `EARNINGS_CALENDAR_URL=https://scanner.tradingview.com`, `NEWS_SERVICE_URL=https://news-headlines.tradingview.com`, `NEWS_MEDIATOR_URL=https://news-mediator.tradingview.com`, `NEWS_STREAMING_URL=https://notifications.tradingview.com/news/channel`, `SCREENER_HOST=https://scanner.tradingview.com` |
| `screener` | `SCREENER_HOST=https://scanner.tradingview.com`, `SS_HOST=symbol-search.tradingview.com`, `WIDGET_SHERIFF_HOST=https://widget-sheriff.tradingview-widget.com`, `CRUD_STORAGE_URL=https://crud-storage.tradingview.com` |
| `events` | `CHARTEVENTS_URL=https://chartevents-reuters.tradingview.com/`, `PUSHSTREAM_URL=wss://pushstream.tradingview.com` |

These globals show widgets are not a thin static embed layer; they reuse chart data, scanner, symbol search, news, calendar, Pine, pushstream, and persistence-adjacent services.

## Entry Bundle Findings

Iframe shells reference per-widget runtime and entry bundles under `https://static.tradingview.com/static/bundles/`. All referenced scripts in this pass were fetched successfully.

High-signal derived findings:

- `embed_screener_v1_widget.*.js` contains screener product families: `Stock`, `StockCompact`, `Forex`, `Futures`, `ContinuousFutures`, `Cfd`, `Crypto`, `CryptoMkt`, `CryptoBySymbol`, `CryptoMktBySymbol`, `Sector`, `Industry`, `Currency`, `Bonds`, `PreMarket`, and `PostMarket`.
- The screener widget entry also embeds column-set families including overview, performance, extended hours, valuation, dividends, margins, income statement, and balance sheet. This is a widget-specific scanner surface, not just a generic `/v1/scan` alias.
- `embed_advanced_chart.*.js` exposes a parent-window message API. Inbound messages include `set-symbol` and `set-interval`; outbound events include `tv-widget-symbol-click`, `tv-widget-load`, `tv-widget-ready`, `tv-widget-resize-iframe`, and `tv-widget-no-data`.
- Advanced Chart registers analysis/product views including `financials`, `technicals`, `seasonals`, `analysis`, `forecast`, `options`, `economy-indicators`, `bonds`, `documents`, `news`, `etfs`, `forward-curve`, `yield-curve`, `contracts`, `community`, and `chart-table-view`.
- Widget runtime bundles contain the same TradingView `~m~<length>~m~<json>` WebSocket framing class used in direct chart/widgetdata probes.

## Failure Classification

| Observation | Classification | Robust handling |
| --- | --- | --- |
| Initial docs fetch wrote gzip bytes as UTF-8 and corrupted files | harness/invocation | Refetch binary, decompress correctly, and do not downgrade TradingView docs availability |
| Guessed route `/widget-docs/widgets/heatmaps/forex-heat-map/` returned 404 | route-discovery miss | Canonical docs route is `/widget-docs/widgets/heatmaps/forex-heatmap/`; retry with route inventory |
| Guessed route `/widget-docs/widgets/market-overview/market-overview/` returned 404 | route-discovery miss | Canonical family is under `/widget-docs/widgets/watchlists/market-overview` |
| Guessed route `/widget-docs/widgets/technical-analysis/technical-analysis/` returned 404 | route-discovery miss | Canonical family is under `/widget-docs/widgets/symbol-details/technical-analysis` |
| Guessed routes under `/widgets/fundamental-data/` returned 404 | route-discovery miss | Canonical family is under `/widget-docs/widgets/symbol-details/` |
| Guessed script `embed-widget-crypto-mkt-screener.js` returned 403 XML | script-name/object mismatch or restricted object | Docs route exists; do not treat guessed script-name failure as absent capability |

No network outage was observed in this widget pass. If later widget probes fail with DNS, TCP reset, timeout, 429, or Cloudflare/transient 5xx, classify them as retryable network/upstream/rate-limit and keep retrying instead of marking the surface absent.

## Worker Gap

Current Worker support remains indirect: generic scanner, quotes, TA, news, calendars, and chart WebSocket primitives can cover pieces of widget behavior, but widgets/embeds are not first-class in the Worker API.

Missing or unmodeled surfaces:

- Widgetdocs inventory and versioned external-embedding script catalog.
- Widget iframe metadata endpoint or route inventory.
- `widgetdata` WebSocket session behavior per widget class, including `symbol-overview`, ticker/tape, market overview/quotes, heatmaps, technical analysis, and advanced chart.
- Widget Sheriff behavior and failure semantics.
- Widget postMessage API modeling for Advanced Chart; public `set-symbol` parent-event behavior is proven, while interval/socket deltas still need runtime classification.
- Widget-specific screener product-family presets and default column sets.
- Widget persistence interactions through `crud-storage` where applicable.

## Next Probes

1. Continue Advanced Chart controlled postMessage capture for `set-interval` observable effects and socket-frame deltas; `set-symbol` parent `quoteUpdate` behavior is already proven.
2. Run a longer timeline/news interaction capture or decompile `embed_timeline_widget` request builders.
3. Find a populated `chartevents-reuters.tradingview.com/events` window/country set for events-widget response schema.
4. Probe more Widget Sheriff parameters and negative cases beyond missing-origin validation.
5. Capture sanitized scanner request bodies for crypto/forex/bond/futures widget presets, then compare them with product-page scanner bodies already captured in `docs/tradingview-product-runtime-capture-2026-05-07.md`.
6. Decide whether widgets should become a first-class Worker route family or remain mapped onto existing scanner/chart/news/calendar primitives with a metadata route.

## Completion Decision

The widget/embed frontier is materially upgraded but not fully complete. Public docs, script, iframe, runtime-host, and selected entry-bundle surfaces are captured. Interactive frame/schema coverage remains open and should continue as a focused public-browser runtime pass before any Worker API design is finalized.
