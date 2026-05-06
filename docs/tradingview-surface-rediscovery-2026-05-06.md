# TradingView Surface Rediscovery - 2026-05-06

## Status

- Bead: `tradingview-cef`
- Task class: planned multi-item research execution, documentation artifact only in this pass
- Baseline commit: `fd2460a28557184c09c637303eb4f1dd7ff978c9`
- Evidence timestamp: `2026-05-06T20:29:32Z`
- Scope covered in this pass: public unauthenticated TradingView homepage, chart page, markets page, linked JavaScript bundles, current Worker/core/skill authority, and selected public service-host probes
- Expanded public product-page delta: `docs/tradingview-surface-expansion-2026-05-06.md`
- WebSocket protocol checkpoint: `docs/tradingview-websocket-rediscovery-2026-05-06.md`
- Sanitized authenticated HAR runtime capture: `docs/tradingview-har-runtime-capture-2026-05-06.md`
- Clean-browser unauthenticated runtime capture: `docs/tradingview-unauth-browser-runtime-2026-05-07.md`
- Direct no-cookie probes for HAR-observed read surfaces: `docs/tradingview-direct-unauth-probes-2026-05-07.md`
- Browser WebSocket chart capture: `docs/tradingview-browser-websocket-capture-2026-05-07.md`
- Options runtime capture: `docs/tradingview-options-runtime-capture-2026-05-07.md`
- Parallel discovery synthesis: `docs/tradingview-parallel-discovery-synthesis-2026-05-07.md`
- Product runtime capture: `docs/tradingview-product-runtime-capture-2026-05-07.md`
- Pine/calendar direct probes: `docs/tradingview-pine-calendar-direct-probes-2026-05-07.md`
- Shell page bundle mining: `docs/tradingview-shell-page-bundle-mining-2026-05-07.md`
- Completion audit: `docs/tradingview-rediscovery-completion-audit-2026-05-07.md`
- Widgets/embed runtime capture: `docs/tradingview-widgets-embed-runtime-2026-05-07.md`
- Widget browser runtime capture: `docs/tradingview-widget-browser-runtime-capture-2026-05-07.md`
- Macro maps browser runtime capture: `docs/tradingview-macro-maps-browser-runtime-capture-2026-05-07.md`
- Yield curves runtime probes: `docs/tradingview-yield-curves-runtime-probes-2026-05-07.md`
- Scope not yet covered: authenticated browser network capture, plan-gated UI paths, full WebSocket frame capture, source maps, account-specific watchlists/layouts/alerts, mobile app traffic, and all locale/product pages beyond sampled pages

This is not a completeness claim. The purpose of this pass is to turn the unknown-unknown workflow into durable evidence and identify the next probes required to keep rediscovering surfaces when TradingView changes.

## Source Requirement

The active requirement is to rediscover all TradingView surfaces, including visible and invisible surfaces, and explicitly push the explore phase for unknown unknowns rather than auditing only what the Worker already knows.

Reference workflow: `skills/tradingview/surface-rediscovery.md`.

## Probe Record

| Probe | Command / source | Result | Evidence level |
| --- | --- | --- | --- |
| Repo route baseline | `rg -n "app\\.(get|post|put|delete|patch|all)\\(" worker/src/index.ts` | 40 Worker routes detected | static |
| Public page fetch | `curl -L --compressed ... https://www.tradingview.com/`, `/chart/`, `/markets/` | all returned HTTP 200 | live public |
| Bundle URL inventory | `rg -o "https://static\\.tradingview\\.com/static/bundles/...\\.js" ...` | 84 unique JS bundle URLs from sampled pages | live public + static bundle |
| Bundle download | `while read url; curl -L --compressed ...` | 84 JS assets downloaded to temp, 5.4 MB | live public |
| Host/path lead extraction | `rg -o -a "[A-Za-z0-9_.-]+\\.tradingview\\.com..."` | 1,188 host/path strings | static bundle |
| UI/API path lead extraction | `rg -o -a "(/[A-Za-z0-9_-]+){2,}..."` | 853 path strings | static bundle |
| Keyword lead extraction | `rg -n -a "chart_create_session|resolve_symbol|...|history-data"` | 617 keyword hit lines | static bundle |
| Selected live service probes | `curl -L --compressed ... pricealerts/scanner-backend/pine-facade/economic-calendar/news/scanner` | mixed 200, 403, 404, DNS failure | live public |
| Anti-detect browser option | Inspected `https://github.com/daijro/camoufox` README | Camoufox is Playwright-compatible and built for AI-agent browser automation with fingerprint/stealth controls | source-backed tooling option |

Counterexample shown: if the Worker route baseline were treated as the whole world, the bundle probes would fail this artifact by showing service hosts and route families absent from `worker/openapi.yaml`, including `options-*`, `portfolio`, `papertrading`, `pricealerts`, `charts-storage`, `screener-storage`, `screener-facade`, and large product route families. If bundle regexes are too narrow, the `path-leads` zero-hit failure seen during this pass demonstrates a false negative; the corrected `path-leads2` probe catches that failure mode.

## Current Repo Authority Baseline

Runtime authority is the Worker and shared core:

- `worker/src/index.ts`: HTTP API routing.
- `worker/src/tradingview.ts`: upstream TradingView integrations.
- `worker/src/tv-raw-socket.ts`: raw framed TradingView WebSocket client.
- `worker/openapi.yaml`: public Worker API contract.
- `packages/tradingview-core/src`: shared candle/timeframe/message framing/types/backtest/Pine type boundary.
- `skills/tradingview/`: procedural workflows, including the new rediscovery reference.

Current Worker surface categories:

- Health, root inventory, admin TradingView session storage/unblock/status.
- Candle fetch, cache status/fill/invalidate/snapshot/restore/selftest/integration-test.
- Quotes, technical analysis, TA summary, scanner, search, indicators, private indicators, study, backfill, replay.
- News headline/content, fundamentals, movers, ideas, Minds, user profile, symbol resolve.
- Market overview, sector movers, industry movers.
- Login, auth token derivation, dividend calendar, earnings calendar.
- Stream bootstrap and metadata routes for markets, news, fundamentals, timeframes.

## Public Live Surfaces Discovered

### Chart WebSocket And Chart Storage

Evidence from `/chart/` HTML:

- `window.WEBSOCKET_HOST = "data.tradingview.com"`
- `window.WEBSOCKET_PRO_HOST = "prodata.tradingview.com"`
- `window.WEBSOCKET_HOST_FOR_DEEP_BACKTESTING = "history-data.tradingview.com"`
- `window.WEBSOCKET_CONNECTION_TYPE = "chart"`
- WebSocket path construction appends `socket.io/websocket`, `from`, `date`, optional `client`, optional `type`, and `auth=sessionid` outside widget-token/widget contexts.
- Chart storage/service hosts include `charts-storage.tradingview.com/charts-storage`, `crud-storage.tradingview.com`, and `/auth/charts-storage/layout`.

Repo support:

- Partial. Core message framing and raw chart WebSocket support exist; deep backtesting host, storage/auth layout flows, chart uploads, and full browser-derived frame inventory are not covered.

### Alerts And Notifications

Evidence:

- Bundle/page hosts include `pricealerts.tradingview.com`, `alerts.tradingview.com/alerts/health/`, `notifications.tradingview.com/news/channel`, and telemetry paths for alerts.
- Live probe `https://pricealerts.tradingview.com/is_alive` returned HTTP 200 with a TradingView JSON error: `no_such_endpoint`.
- Live probe `https://alerts.tradingview.com/alerts/health/` failed DNS resolution from this environment at `2026-05-06T20:29Z`.
- Feature flags include alert-related gates such as alert presets, webhook status display, request initiator tracking, watchlist alert multiconditions, event read sequencing, fire-rate settings, and screener alerts read-only.

Repo support:

- Absent for alert CRUD/session/log/widget behavior. The DNS failure is a network/resolution classification, not proof that the surface is absent.

### Pine, Indicators, Scripts, Study Templates

Evidence:

- Public footer/product routes include Pine Script docs and Pine Screener.
- Bundle/page leads include `pine-facade.tradingview.com/pine-facade`, `/chart-api/studies_metadata`, `/chart-api/studies_metadata_widget`, `/api/v1/scripts`, `/api/v1/main_page/scripts`, `/api/v1/study-templates`, `/api/v1/study-templates/standard`, `pine-editor-*`, `pine.monarch.v4`, `pine.monarch.v5`, `pine.monarch.v6`, and `pine-editor-test-api`.
- Live probe `https://pine-facade.tradingview.com/pine-facade/is_auth_to_get/STD%3BSMA/last` returned HTTP 200 with body `true`.

Repo support:

- Partial. Indicator search/meta/private indicators and study execution exist. Pine script save/list/compile/editor flows are typed in core but not wired as Worker surfaces in this pass. Study templates and Pine facade auth/capability endpoints are not fully exposed.

### Screeners, Scanner, Heatmaps, And Market Pages

Evidence:

- UI route families include `/screener/`, `/etf-screener/`, `/bond-screener/`, `/crypto-coins-screener/`, `/cex-screener/`, `/dex-screener/`, `/pine-screener/`.
- Heatmap routes include `/heatmap/stock/`, `/heatmap/etf/`, `/heatmap/crypto/`.
- Hosts include `scanner.tradingview.com`, `scanner-backend.tradingview.com`, `screener-facade.tradingview.com/screener-facade`, and `screener-storage.tradingview.com/screener-storage`.
- Live probe `https://scanner-backend.tradingview.com/enum/ordered?id=metrics_full_name,metrics&lang=en&label-product=ytm-metrics-plan.json` returned HTTP 200 with enum JSON.
- Live probe `https://scanner.tradingview.com/` returned HTTP 404 root response; this only proves root path absence, not scanner API absence.
- Feature flags include multiple screener gates: creation allowed, autosave, undo/redo, save view mode, bond restriction by auth, bond rating column restriction, coin derivative columns, screener alerts read-only.

Repo support:

- Partial. Generic scanner and market movers exist. Screener facade/storage, view persistence, heatmap surfaces, and screener alert interactions are absent.

### Calendars, Macro Maps, Yield Curves, Fundamentals, And Seasonals

Evidence:

- Product/footer routes include `/economic-calendar/`, `/earnings-calendar/`, `/dividend-calendar/`, `/yield-curves/`, `/macro-maps/`, `/fundamental-graphs/`.
- Host `economic-calendar.tradingview.com` is present in chart page config.
- Live root probe `https://economic-calendar.tradingview.com/` returned HTTP 403. This is a gated/root-path classification, not absence.
- Bundle chunks mention `economic-calendar`, `tab-economic-calendar`, `show-economy-indicator-dialog`, `show-economy-indicators-dialog`, `fundamental-graphs-api`, `financial-graphs-symbol-search`, `init-symbol-page-tab-seasonals`, `init-symbol-page-tab-forward-curve`, `init-symbol-page-tab-yield-curve`, and `/financial/fundamentals_config_v2`.

Repo support:

- Partial. Dividend/earnings calendars and fundamentals exist. Economic calendar, macro maps, yield curves, seasonals, forward curve, and fundamentals graph APIs are absent or unverified.

### News, Ideas, Minds, Community, And Media

Evidence:

- Hosts include `news-headlines.tradingview.com`, `news-mediator.tradingview.com`, `notifications.tradingview.com/news/channel`, `s3.tradingview.com/news/`, `ideas-uploader.tradingview.com/api`, and `tradingview-user-uploads.b-cdn.net`.
- Routes include `/api/v1/main_page/community_ideas`, `/api/v1/ideas`, `/ideas/`, `/ideas/editors-picks/`, `/ideas/followed-authors/`, `/ideas/for-you/`, and `/news-flow/`.
- Live root probe `https://news-headlines.tradingview.com/` returned HTTP 404 root response.
- Runtime chunks include `news-flow-dialog`, `news-symbol-select-dialog`, `news-alerts-limit-dialog`, `news-manage-alerts-dialog`, `chart-news`, `news-notification-system`, `minds-list`, `community-hub-dialog`, `community-hub-idea-card`, and `community-hub-mind-card`.

Repo support:

- Partial. News, news content, ideas, and Minds exist. Upload/media flows, news notifications, news alerts, news-flow UI API, recommendation feeds, community hub interactions, and authenticated personalization are absent or unverified.

### Watchlists, Layouts, Drawings, Replay, Backtesting

Evidence:

- Route and chunk leads include `/api/v1/symbols_list`, `/api/v1/symbols_list/active`, `/api/v1/symbols_list/all`, `/api/v1/symbols_list/custom`, `watchlist-dialog`, `show-watchlists-dialog`, `watchlist-alerts-limit`, `layout-settings-drawer-api`, `create-layout-dialog`, `load-chart-dialog`, `line-tools-storage`, `favorite-drawings-api`, `chart-save-metainfo`, `replay-trading-widget-controller`, `bottom-backtesting-widget`, `backtesting-widget`, `backtesting-replay-strategy-facade`, `deep backtesting` host `history-data.tradingview.com`.

Repo support:

- Partial for replay state only. Watchlists, symbol list CRUD, layout storage, drawings, line-tool templates, screenshots/export, backtesting widgets, and deep backtesting host behavior are absent or unverified.

### Options, Portfolio, Paper Trading, Brokers, Trading

Evidence:

- Hosts include `options-charting.tradingview.com`, `options-spread-explorer.tradingview.com`, `options-storage.tradingview.com`, `portfolio.tradingview.com/portfolio/v1`, `papertrading.tradingview.com`, `rest-demo.tradingview.com/tradingview/v1`, and `tv-partners.tradingview.com`.
- UI routes/chunks include `/options/`, `init-symbol-page-tab-options`, `options-builder-dialog`, `portfolio-setup-dialog`, `show-portfolio-dialog`, `portfolios-dialog`, `portfolio-paper-trading-provider`, `paper-api`, `paper`, `paper-competition-dialog`, `trading-order-ticket`, `trading-dom`, many broker flags, and broker-specific modules.

Repo support:

- Absent. These are separate product surfaces with likely auth, broker, plan, and account gates.

### Widgets And Embeds

Evidence:

- Chart page widget-detection patterns include `widgetembed`, `widgetstatic`, `mediumwidgetembed`, `twitter-chart`, `telegram/chart`, `embed/<id>`, `widgetpopup`, `extension`, `idea-popup`, `hotlistswidgetembed`, `marketoverviewwidgetembed`, `eventswidgetembed`, `tickerswidgetembed`, `forexcrossrateswidgetembed`, `forexheatmapwidgetembed`, `marketquoteswidgetembed`, `screenerwidget`, `cryptomktscreenerwidget`, `technical-analysis-widget-embed`, `singlequotewidgetembed`, `embed-widget`, and `widget-docs`.
- Hosts include `www.tradingview-widget.com`.
- Follow-up widget pass proved live public docs, S3 external-embedding scripts, and 19 no-cookie `https://www.tradingview-widget.com/embed-widget/{id}/` iframe shells. Captured IDs include `advanced-chart`, `screener`, `symbol-overview`, `tickers`, `ticker-tape`, `single-quote`, `stock-heatmap`, `crypto-coins-heatmap`, `etf-heatmap`, `forex-heat-map`, `market-overview`, `market-quotes`, `symbol-info`, `technical-analysis`, `financials`, `symbol-profile`, `events`, `timeline`, and `forex-cross-rates`.
- Widget iframe globals expose `widgetdata.tradingview.com`, `widgetdata-backup.tradingview.com`, `widget-sheriff.tradingview-widget.com`, `symbol-search.tradingview.com`, `crud-storage.tradingview.com`, and per-widget scanner/news/calendar/Pine/pushstream hosts.
- Entry-bundle mining found the Advanced Chart postMessage API (`set-symbol`, `set-interval`, `tv-widget-ready`, `tv-widget-load`, `tv-widget-no-data`, resize and symbol-click events), a broad advanced-chart analysis view registry, and widget-specific screener product families.
- Chrome DevTools Protocol browser capture proved runtime XHR/WebSocket behavior for `advanced-chart`, `screener`, `stock-heatmap`, `market-overview`, `timeline`, `events`, `technical-analysis`, and `symbol-info`: `widgetdata` WebSockets, public pushstream open-idle, Widget Sheriff 204 checks and 400 missing-origin validation, scanner REST and body shapes for stock screener/heatmap defaults, scanner-backend enum metadata, technical-analysis scanner fields, chart-events no-data envelope, support metadata, static conversions, logo assets, and telemetry. Follow-up direct probes proved timeline SSR init-data news rows, Widget Sheriff valid/malformed/missing-origin and method semantics, populated Reuters event rows, economic-calendar related-history rows with browser-origin invocation semantics, and representative forex/crypto/crypto-market/futures/bonds screener widget scanner bodies.

Repo support:

- Absent as a first-class surface, except indirectly through chart data, scanner, market, news, calendar, and TA endpoints.

### Auth, User, Billing, Mobile, And Account Infrastructure

Evidence:

- API/path leads include `/api/v1/user/profile`, `/api/v1/users`, `/api/v1/recover_password`, `/api/v1/recover_password/search`, `/api/v1/recover_password/check_phone_code`, `/api/v1/users/anon/change-email/resend`.
- Feature flags include sign-in recaptcha, Google one-tap sign-in, login-from-new-device email, two-factor flows, phone/email flows, payment providers, receipts, purchase/refund controls, subscription changes, KYC dialogs, and multiple mobile app gates.

Repo support:

- Partial and intentionally narrow. Worker can store/derive TradingView browser sessions and fetch `/v1/me`; it does not model account recovery, billing, MFA, KYC, mobile app, or broader account mutation surfaces. Those should remain out of scope unless explicitly authorized.

## Gap Inventory

| Surface | Evidence | Current support | Next probe |
| --- | --- | --- | --- |
| Deep backtesting WebSocket | `history-data.tradingview.com` from chart HTML | absent/partial | Browser frame capture during deep backtesting UI |
| Chart/layout storage | `charts-storage`, `crud-storage`, `/auth/charts-storage/layout` | absent | Authenticated layout save/load network capture |
| Alerts | `pricealerts`, `alerts`, feature flags | absent | Authenticated alert create/edit/delete/log capture; retry classification for DNS/service failures |
| Screener facade/storage | `screener-facade`, `screener-storage`, screener flags | absent/partial | Save/autosave screener view and alert flow capture |
| Heatmaps | `/heatmap/stock`, `/heatmap/etf`, `/heatmap/crypto` | absent | Fetch pages and bundle chunks; identify backend calls |
| Economic calendar | host + 403 root + UI chunks | partial | Trigger calendar UI with query params and capture XHR |
| Yield curves/macro maps/seasonals | route/chunk leads; macro maps default `IRYY` browser WebSocket quote snapshots over `data.tradingview.com`; direct public macro-map probes for non-default indicator quote snapshots, GDP historical series frames, and macro quote field list; yield curves default component-data and browser-rendered US table; yield `available_countries` term registry; direct public AU/DE/JP non-US yield quote snapshots; guest Add Country promo gate and guest settings menu; bundle-derived Add Country/settings/clone/delete/storage paths | absent/partial | Capture macro map filter-only indicators, country group changes, exact country-code list changes, and historical slider UI event sequencing; capture authenticated yield Add/settings/clone/delete persistence, date-specific non-US chart snapshoter path, and seasonals parameter exploration |
| Pine editor/save/compile | Pine chunks, scripts/study-template paths | partial | Authenticated Pine editor save/compile/list capture |
| Watchlists/symbol lists | `/api/v1/symbols_list/*`, watchlist chunks | absent | Authenticated watchlist CRUD capture |
| Options | options hosts/chunks/routes | absent | Options page and symbol tab network capture |
| Portfolio/paper trading | portfolio/papertrading hosts/chunks | absent | Authenticated paper account and portfolio dialog capture |
| Brokers/trading | broker flags/chunks/rest-demo | absent | Read-only broker selector/session capability map; no order placement |
| Widgets/embeds | widget route patterns, docs route tree, public iframe shells, S3 embed scripts, runtime host globals, entry-bundle API leads, browser runtime XHR/WebSocket host and frame evidence, timeline SSR init-data news rows, stock screener/heatmap body shapes, forex/crypto/crypto-market/futures/bonds screener widget body shapes, technical-analysis scanner fields, Widget Sheriff validation/method semantics, chart-events no-data envelope, populated Reuters events schema, economic-calendar related-history schema | absent/indirect | Capture remaining Advanced Chart socket-frame postMessage deltas, optional timeline pagination/filtering, interaction-driven widget scanner deltas, and decide first-class Worker model vs mapping to existing primitives |
| News alerts/notifications | notifications/news/channel + news chunks | partial | News alert creation/channel subscription capture |
| Community uploads | `ideas-uploader`, user upload CDN | absent | Read-only inspect upload endpoints; no publish mutation without explicit authorization |

## Failure Classification From This Pass

- Network/resolution: `alerts.tradingview.com` failed DNS resolution from this environment. Retry later; do not downgrade or remove the alert surface.
- Gated/root-only: `economic-calendar.tradingview.com/` returned 403; treat as host exists but root path not publicly readable.
- Root path absent: `news-headlines.tradingview.com/` and `scanner.tradingview.com/` returned 404 at root; endpoint-specific routes may still exist.
- Endpoint mismatch: `pricealerts.tradingview.com/is_alive` returned HTTP 200 with TradingView JSON `no_such_endpoint`; host exists, this specific path is not valid.
- Harness/invocation: the first widget docs fetch corrupted gzip bytes by writing them as UTF-8; the corrected binary/decompression fetch succeeded, so the failure is not TradingView availability evidence.
- Route-discovery miss: several guessed widget docs paths returned 404 even though canonical routes existed elsewhere in the docs tree. Treat guessed route failures as route mismatch until the canonical index is checked.
- Positive live endpoint: scanner enum and Pine facade auth probes returned HTTP 200.

## Prioritized Roadmap

1. Authenticated browser capture pass: sanitized HAR analysis now distinguishes unauthenticated-achievable, authenticated-observed, and auth-status-unknown surfaces in `docs/tradingview-har-runtime-capture-2026-05-06.md`. Still open: alert create/edit/delete, layout/watchlist mutation, options XHR, portfolio/paper runtime calls, replay/deep-backtesting WebSocket frames, and redacted request/response schema fixtures.
2. Unauthenticated browser runtime pass: clean Playwright context proves public product data calls for options scanner bootstrap, stock heatmap scanner feed, economic calendar events, dividend/earnings calendar feeds, and options symbol search in `docs/tradingview-unauth-browser-runtime-2026-05-07.md`.
3. Direct unauthenticated endpoint pass: no-cookie probes against HAR-observed read endpoints identify which cookie-bearing HAR calls are actually public and which return auth gates. Current artifact: `docs/tradingview-direct-unauth-probes-2026-05-07.md`.
4. Bundle expansion pass: fetched product-specific pages for heatmaps, economic calendar, yield curves, macro maps, options, portfolio, paper trading, widgets, Pine screener, CEX/DEX screeners, and compared new bundle chunks against this baseline. Options first-load runtime request shapes are now captured in `docs/tradingview-options-runtime-capture-2026-05-07.md`. Current expansion artifact: `docs/tradingview-surface-expansion-2026-05-06.md`.
5. WebSocket protocol pass: direct unauthenticated probes captured `data`, `prodata`, `history-data`, and `widgetdata` chart/quote/candle frame names; browser chart capture added public `pushstream` and normal chart lifecycle/study/tickmark message names. Current artifacts: `docs/tradingview-websocket-rediscovery-2026-05-06.md` and `docs/tradingview-browser-websocket-capture-2026-05-07.md`. Browser replay/deep-backtesting and authenticated payload-schema capture remain open.
6. Product runtime pass: clean-browser capture promoted ETF/crypto heatmaps and CEX/DEX/bond/ETF screeners from static/page leads to public scanner/metainfo/enum runtime surfaces in `docs/tradingview-product-runtime-capture-2026-05-07.md`.
7. Pine/calendar direct pass: exact no-cookie replay of safe HAR scanner shapes promoted markets-earnings, IPO calendar, related-symbols, bond details, Pine versions, and Pine translate to unauthenticated-achievable in `docs/tradingview-pine-calendar-direct-probes-2026-05-07.md`.
8. Shell-page bundle mining pass: temp-only bundle extraction found yield-curves component-data, macro maps shell state, and Pine Screener scan host/method/credential behavior in `docs/tradingview-shell-page-bundle-mining-2026-05-07.md`.
9. Pine Screener / macro maps decompilation pass: derived Pine Screener scan body construction, proved a structurally valid no-cookie scan reaches an auth/header gate, and identified macro maps as a ChartApi-backed economic-symbol quote/series composition in `docs/tradingview-pine-screener-macro-decompilation-2026-05-07.md`.
10. Parallel surface-family pass: six read-only explorers plus local news/community/widget inspection synthesized into `docs/tradingview-parallel-discovery-synthesis-2026-05-07.md`; platform thread limit prevented launching all ten proposed agents at once.
11. Worker gap implementation planning: group additions by authority boundary: chart/session protocol, screeners/storage, Pine/script, calendar/macro, alerts/notifications, watchlists/layouts, options/portfolio/paper.
12. Completion audit: `docs/tradingview-rediscovery-completion-audit-2026-05-07.md` maps every explicit rediscovery requirement to artifacts and records remaining blockers.
12. Robustness pass: every new upstream integration must preserve error categories `network`, `rate_limit`, `auth`, `upstream`, `bad_request`, and should retry network failures without downgrading capability state.

## Runtime Capture Tooling

Preferred order for authenticated/runtime rediscovery:

1. Reuse a real logged-in browser profile when available, because session state is the authority for account-gated surfaces.
2. Use Camoufox as the fallback or comparative browser when ordinary automation changes the visible surface, blocks requests, or changes network behavior. Camoufox should be treated as a capture tool, not a runtime dependency.
3. Preserve HAR/WebSocket frame logs with failure classification. If a host fails from DNS, TLS, timeout, 403, 404, auth, plan limit, or rate limit, record that exact class and retry later; do not remove or downgrade the surface from the inventory.
4. Decompile or beautify TradingView JavaScript bundles when minification hides route/message names. Keep derived evidence as small excerpts, indexes, or generated inventories rather than committing full third-party bundles.

## Acceptance Holes

Negative-probe hole: authenticated and plan-gated surfaces may exist that no public HTML/bundle fetch exposes or that are only emitted after UI interaction. This pass cannot prove absence for those surfaces.

Positive-probe hole: several discovered hosts are only host/root or bundle-string evidence; their concrete request/response schemas remain unproven until browser network capture or endpoint-specific probing.

Residual unknowns:

- Whether the local browser profile is logged in to TradingView.
- Which plan tier/account permissions are available.
- Which service-host endpoints require CSRF, session cookies, signed headers, or widget tokens.
- Whether source maps are published for the sampled bundles.
- Whether mobile app or desktop app uses additional hosts not present in public web bundles.
