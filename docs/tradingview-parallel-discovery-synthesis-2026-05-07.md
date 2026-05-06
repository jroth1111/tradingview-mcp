# TradingView Parallel Discovery Synthesis - 2026-05-07

## Status

- Bead: `tradingview-cef`
- Mode: parallel read-only exploration plus local news/community/widget pass
- Requested shape: specialized agents with HAR, unauth artifacts, Worker authority files, and permission to mine unknown unknowns
- Reusable lane prompt: `skills/tradingview/reference/parallel-surface-discovery-prompt.md`
- Actual parallelism: six explorers launched before the platform thread limit was reached
- Sensitive source: `/Users/gwizz/Downloads/www.tradingview.com.har`

No explorer edited files. HAR-derived evidence below is sanitized: host/path/method/status/query-key/body-key/classification only. No cookies, JWTs, session IDs, authorization values, or account-specific payload values are recorded.

## Inputs Given To Explorers

- Sensitive HAR path: `/Users/gwizz/Downloads/www.tradingview.com.har`
- Existing rediscovery artifacts under `docs/tradingview-*.md`
- Worker authority:
  - `worker/openapi.yaml`
  - `worker/src/index.ts`
  - `worker/src/tradingview.ts`
- Shared authority:
  - `packages/tradingview-core/src/constants.ts`

## Surface Families Covered

| Family | Explorer / mode | Result |
| --- | --- | --- |
| Alerts and notifications | parallel explorer | alerts read endpoints confirmed auth-required; news mediator public; news notification and mutation surfaces still open |
| Chart storage, layouts, drawings, screenshots, watchlists | parallel explorer | watchlist auth split sharpened; chart storage/JWT and layout/drawing mutation gaps isolated |
| Options, portfolio, paper trading, brokers | parallel explorer | options first-load public and scanner-backed; portfolio/paper remain authenticated-interaction gaps; broker metadata public |
| Pine, Pine Screener, indicators, studies, scripts | parallel explorer | Pine public built-in/support surfaces sharpened; eval/translate/user-script and Pine Screener still need targeted probes |
| Screeners, scanners, heatmaps | parallel explorer | scanner body families and screener persistence gaps isolated; heatmap stock public, ETF/crypto still need runtime capture |
| Calendars, macro maps, yield curves, fundamentals | parallel explorer | economic events and supporting metadata public; IPO/bond/related scanner shapes identified; macro/yield runtime still open |
| News, ideas, Minds, chats/support, widgets/embeds | local pass due thread limit, then focused widget static and browser-runtime passes | news mediator public; chats/support unread auth-gated; widgets upgraded from static leads to live docs/scripts/iframe/runtime-host and representative browser XHR/WebSocket evidence |

## Auth Classification Upgrades

### Unauthenticated-Achievable

- `news-mediator.tradingview.com/public/news-flow/v2/news`
- `news-mediator.tradingview.com/public/view/v1/symbol`
- `economic-calendar.tradingview.com/events`
- `scanner.tradingview.com/global/scan?label-product=calendar-dividends`
- `scanner.tradingview.com/global/scan?label-product=calendar-earnings`
- `scanner.tradingview.com/america/scan?label-product=heatmap-stock`
- `scanner.tradingview.com/options/scan2?label-product=options-builder`
- `scanner.tradingview.com/global/scan2?label-product=options-builder`
- `symbol-search.tradingview.com/symbol_search/v3/?only_has_options=true`
- `scanner.tradingview.com/symbol`
- `scanner-backend.tradingview.com/enum/ordered`
- `www.tradingview.com/api/v1/symbols_list/custom/` for default/no-session payload
- `www.tradingview.com/api/v1/study-templates` for standard templates
- `www.tradingview.com/api/v1/script_packages/store/`
- `pine-facade.tradingview.com/pine-facade/list?filter=standard|fundamental|candlestick`
- `pine-facade.tradingview.com/pine-facade/list?filter=saved` as no-session empty list
- `pine-facade.tradingview.com/pine-facade/is_auth_to_get/STD%3BSMA/last`
- `www.tradingview.com/api/v1/brokers/trading_panel`
- `www.tradingview.com/financial/fundamentals_config_v2/`
- `s3.tradingview.com/conversions_en.json`
- `wss://pushstream.tradingview.com/message-pipe-ws/public` as observed-open-idle

### Authenticated-Required For Probed Shapes

- `pricealerts.tradingview.com/list_alerts`
- `pricealerts.tradingview.com/get_offline_fires`
- `pricealerts.tradingview.com/get_offline_fire_controls`
- `www.tradingview.com/api/v1/symbols_list/all/`
- `www.tradingview.com/api/v1/symbols_list/colored/`
- `www.tradingview.com/pubscripts-get/personal-access/`
- `support-middleware.tradingview.com/api/v2/unreads/get`

### Auth-Status Unknown / Runtime-Open

- Alert create/edit/delete and detailed fire logs.
- News alert channels and notification management.
- `notifications.tradingview.com/news/channel`.
- `charts-storage.tradingview.com/charts-storage/*` with JWT query parameters.
- `crud-storage.tradingview.com` layout mutation paths.
- Drawing/favorite drawing storage; telemetry is runtime-proven but storage is not.
- `www.tradingview.com/chart-token/` with required `image_url` and `user_id` fields.
- Portfolio and paper trading service calls.
- Options strategy builder, strategy finder, volatility chart, and `options-charting` static leads.
- Pine eval/translate/get-script-info/versions auth-paired behavior.
- Pine Screener `/pine_scanner_http/scan` method/body.
- Screener facade/storage and `/api/v2/screens`.
- ETF/crypto heatmap first-load runtime calls.
- Macro maps, yield curves, seasonals, forward curves, and `/calendar/render`.
- Widget and embed controlled interaction schemas beyond the public docs, script, iframe-shell, runtime-host inventory, and representative browser runtime capture recorded in `docs/tradingview-widgets-embed-runtime-2026-05-07.md` and `docs/tradingview-widget-browser-runtime-capture-2026-05-07.md`.
- Macro maps filter-only indicators, country group switches, exact country-code list changes, and historical slider UI event sequencing beyond the default `IRYY`, non-default `GDP`/`UR`/`INTR`/`GDG`, GDP historical series, and quote-field protocol paths proven in `docs/tradingview-macro-maps-browser-runtime-capture-2026-05-07.md`.

## High-Signal Unknown-Unknown Leads

### Alerts / Notifications

- Price alert reads use JSON-level unauthorized errors even when HTTP status is 200. Worker integrations should classify body `err.code=unauthorized` as `auth`, not `upstream`.
- `alerts.tradingview.com/alerts/health/` previously failed DNS; this is a network/resolution classification and must stay retryable, not a downgrade.
- Public pushstream opened on a clean chart page but stayed idle. Keep it as an observed endpoint family until a UI trigger proves channel behavior.

### Storage / Watchlists / Drawings

- Watchlists have split semantics: `custom` has a public default payload, while `all` and `colored` require login.
- `my-charts` returns an unauthenticated HTML shell without proving saved-chart data access.
- Chart storage reads carry JWT query parameters and sampled payloads were empty; schema-grade proof requires a known non-empty layout.
- Drawing storage is still separated from `line-tools-storage/report` telemetry. Do not confuse telemetry with storage authority.

### Options / Portfolio / Paper / Brokers

- Initial options data is public and scanner-backed, not first-load `options-charting`.
- `options-charting` chain/strategy/volatility paths remain method/context leads because naive GET returned 404.
- Broker trading-panel metadata is public, but authenticated capture may reveal hidden entitlement/region fields.
- Portfolio and paper trading still require authenticated UI capture; public `/portfolio/` and `/paper-trading/` 404 shells are not service absence.

### Pine / Studies / Pine Screener

- Worker already uses public Pine built-in lists and Pine translate metadata, but does not expose the broader facade.
- HAR shows `eval_pine_ex` form keys `username`, `source`, and `inputs`; values remain redacted. Safe eval probing needs a minimal non-secret snippet.
- Pine Screener remains static/page/bundle-only; no HAR or clean-browser request body captured `/pine_scanner_http/scan`.

### Screeners / Heatmaps

- Existing Worker `/v1/scan` is generic and narrower than discovered product families.
- HAR and docs show scanner body families: calendar/IPO, related-symbols, bond detail, options `scan2`, symbol metadata, heatmap scan.
- Screener persistence/facade/storage is separate from scanner data calls and remains unproven.
- `scanner-backend /enum/ordered` is a live public metadata source for field/metric catalogs.

### Calendars / Macro / Yield / Fundamentals

- Economic events are a public candidate for Worker support.
- Extra scanner shapes exist for IPO calendar, market earnings, bond details, and related-symbols.
- Macro maps/yield curves pages and bundles are public. Macro maps runtime is now proven as a public chart-data composition for current quote snapshots and GDP historical series. Yield curves default US component-data is public, non-US AU/DE/JP current yield quotes are public through `data.tradingview.com` quote WebSocket using the `available_countries` term registry, AU/DE/JP 10Y daily history is public through chart `resolve_symbol`/`create_series`, guest Add Country is registration-gated by a promo dialog, guest settings are local UI controls, and the bundle shows Add Country/settings/clone/delete/storage state paths. Seasonals runtime is now proven through `INTERNAL:SEASONALS` plus `Seasonals@tv-basicstudies`, its compressed `du` payload decodes to zipped JSON with `performance` and `seasonals` keys, Table/Average/Percent controls are local presentation variants in observed no-login runs, and year-range changes re-run `create_study` / `modify_study` with a widened `years` config and the same compressed `du` schema; futures forward curves are now proven through futures scanner plus quote WebSocket contract fan-out, with exact scanner schema for `CME_MINI:ES`, replay proof for `NYMEX:CL`, and the same scanner body verified across COMEX/NYMEX/CBOT/CME/ICEUS roots. Authenticated yield Add/settings/clone/delete persistence remains open.
- Fundamentals config is public and can seed metadata instead of hard-coding field lists.

### News / Community / Widgets

- Current Worker news uses `news-headlines.tradingview.com/v2/view/headlines/symbol`, while HAR proves public `news-mediator` flow variants. These are distinct upstream families.
- Chats/support unread are authenticated-required for probed shapes.
- Widgets/embeds have a first-class public docs route tree, S3 external-embedding scripts, 19 no-cookie `tradingview-widget.com/embed-widget/{id}/` shells, runtime globals for `widgetdata`, Widget Sheriff, symbol search, scanner, calendar, news, Pine, pushstream, and CRUD storage, plus entry-bundle evidence for Advanced Chart postMessage events and screener product families. Follow-up browser/direct passes captured representative XHR/WebSocket evidence for advanced-chart, screener, stock-heatmap, market-overview, timeline, events, technical-analysis, and symbol-info; timeline SSR init-data news rows; stock screener/heatmap body shapes; forex/crypto/crypto-market/futures/bonds screener widget body shapes; technical-analysis scanner fields; Widget Sheriff validation/method semantics; chart-events no-data envelope; populated Reuters event schema; and populated economic-calendar related-history schema. Controlled socket-frame postMessage deltas, optional timeline pagination/filtering, interaction-driven widget scanner deltas, and Worker modeling are still needed before Worker design is finalized.

## Worker Authority Gap Summary

Current Worker support is still centered on candles, quotes, generic scanner, indicators/study, news headline/content, fundamentals, movers, ideas/Minds, replay, session/admin, dividend/earnings calendars, and metadata.

Major absent or partial families:

- Alerts and notifications.
- Watchlists, chart storage, layouts, drawings, chart token/screenshot.
- Options, portfolio, paper trading, broker panel.
- Pine facade beyond search/meta/private/study, plus Pine Screener.
- Product-specific screeners, screener facade/storage, heatmaps beyond generic scanner.
- Economic events, IPO calendar, macro maps, yield curves, seasonals, forward curves. Seasonals and forward curves have browser-runtime evidence; the seasonals study payload schema is captured, seasonals Table/Average/Percent controls are local rendering modes over decoded study data, year-range is a verified study config update, and forward-curve scanner schema is captured across multiple futures root families. Other interaction variants remain open.
- News mediator flow, news alerts, pushstream, widgets/embeds.
- Widget-specific Worker modeling remains absent; existing chart/scanner/news/calendar primitives may cover parts of the runtime, but the iframe/postMessage/Widget Sheriff surface is not represented.

Core shared constants are also missing rediscovered endpoint families:

- `history-data.tradingview.com`
- `pushstream.tradingview.com/message-pipe-ws/public`
- HTTP service hosts such as `pricealerts`, `charts-storage`, `crud-storage`, `screener-facade`, `screener-storage`, `options-charting`, `portfolio`, `papertrading`, `scanner-backend`, and `news-mediator`.

## Next Parallel Frontier

The next wave should use either more available agent slots or serial local captures with the same ownership split:

1. Authenticated browser mutations: alert create/edit/delete, watchlist CRUD, layout save/load/delete, drawing add/delete/favorite. These need explicit rollback plans before mutation.
2. Authenticated read-only browser capture: portfolio, paper trading account state, broker/paper panel, saved charts, chart-storage non-empty layout payloads.
3. Public browser runtime: Pine Screener interaction, macro map filter-only indicator/country/slider UI follow-ups, forward-curve UI interaction variants, broader seasonals symbol-class coverage if needed, and widget interaction follow-ups for Advanced Chart socket-frame postMessage deltas, optional timeline pagination/filtering, and interaction-driven widget scanner deltas.
4. Bundle decompilation in temp-only workspace: `calendar_page`, `macro_maps_page`, `yield_curves_page`, `pine_screener`, `new_standalone_screener`, and deeper options chunks.
5. WebSocket UI flows: replay, deep backtesting, pushstream triggers, charts-polygon intended trigger.
6. Paired auth probes: same request shape with and without cookies for every read endpoint promoted from HAR evidence.

Follow-up direct probe artifact: `docs/tradingview-pine-calendar-direct-probes-2026-05-07.md` promotes markets-earnings, IPO calendar, related-symbols, bond details, Pine versions, and Pine translate to unauthenticated-achievable for the probed read-only shapes.

## Completion Audit

The full rediscovery objective is not complete. The parallel pass materially reduced unknowns, but remaining open surfaces require authenticated UI state, explicit user approval for mutations, or deeper bundle/request-builder recovery.
