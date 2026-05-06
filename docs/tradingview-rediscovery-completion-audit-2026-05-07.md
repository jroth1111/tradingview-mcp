# TradingView Rediscovery Completion Audit - 2026-05-07

## Objective

Full TradingView surface rediscovery means:

1. Baseline the current Worker/core/skill authority.
2. Rediscover visible and invisible TradingView surfaces, including unknown unknowns.
3. Distinguish unauthenticated, authenticated-required, authenticated-observed, auth-unknown, shape-gated, network/upstream/rate-limit, and static-only evidence.
4. Produce durable artifacts for public page, bundle, HAR, direct probe, browser runtime, WebSocket, and parallel surface-family discovery.
5. Record concrete Worker coverage gaps and next probes.
6. Avoid downgrading any capability because of network, shape, root-path, or invocation failures.

This audit does not mark the objective complete. It maps completed evidence and the remaining blockers.

## Prompt-To-Artifact Checklist

| Requirement | Evidence | Status |
| --- | --- | --- |
| Add reusable unknown-unknown workflow to the skill | `skills/tradingview/surface-rediscovery.md`; linked from `skills/tradingview/SKILL.md`; validated by `pnpm run skill:validate` | verified |
| Baseline current Worker/core/skill authority | `docs/tradingview-surface-rediscovery-2026-05-06.md` records Worker routes, core constants, and skill boundary | verified |
| Public unauthenticated page and bundle inventory | `docs/tradingview-surface-rediscovery-2026-05-06.md`; `docs/tradingview-surface-expansion-2026-05-06.md` | verified |
| Use Camoufox/decompilation as optional discovery tooling | `docs/tradingview-surface-rediscovery-2026-05-06.md` records Camoufox as optional and allows temp-only bundle mining | verified |
| Distinguish unauthenticated vs authenticated from HAR | `docs/tradingview-har-runtime-capture-2026-05-06.md`; `docs/tradingview-har-schema-sketches-2026-05-06.md` | verified, but HAR is not exhaustive |
| Do not commit sensitive HAR content | HAR path remains local; committed artifacts are sanitized summaries and shape sketches only | verified by inspection of committed docs |
| Direct no-cookie read probes against HAR-observed endpoints | `docs/tradingview-direct-unauth-probes-2026-05-07.md`; `docs/tradingview-pine-calendar-direct-probes-2026-05-07.md` | verified |
| Public browser runtime capture | `docs/tradingview-unauth-browser-runtime-2026-05-07.md`; `docs/tradingview-options-runtime-capture-2026-05-07.md`; `docs/tradingview-product-runtime-capture-2026-05-07.md` | verified |
| Browser WebSocket capture | `docs/tradingview-browser-websocket-capture-2026-05-07.md` | verified for normal unauth chart; replay/deep backtesting still open |
| Direct WebSocket endpoint probing | `docs/tradingview-websocket-rediscovery-2026-05-06.md` | verified for data/prodata/history-data/widgetdata; charts-polygon trigger still open |
| Parallel specialized discovery | `docs/tradingview-parallel-discovery-synthesis-2026-05-07.md` | partially verified; six agents ran, platform limit prevented ten concurrent agents |
| Product runtime surface expansion | `docs/tradingview-product-runtime-capture-2026-05-07.md` | verified for ETF/crypto heatmaps and CEX/DEX/bond/ETF screeners |
| Shell-page bundle mining | `docs/tradingview-shell-page-bundle-mining-2026-05-07.md` | verified for yield-curves component data, macro-maps shell, Pine Screener transport/UI gate |
| Pine Screener / macro maps decompilation | `docs/tradingview-pine-screener-macro-decompilation-2026-05-07.md` | verified for Pine Screener request body construction, no-cookie auth/header gate, and macro maps ChartApi-backed runtime path |
| Macro maps browser runtime capture | `docs/tradingview-macro-maps-browser-runtime-capture-2026-05-07.md` | verified for public default `IRYY` macro-map browser `data.tradingview.com` WebSocket session, direct public non-default `US{GDP,UR,INTR,GDG}` quote snapshots, direct public historical `ECONOMICS:USGDP` `resolve_symbol`/`create_series` frames, and the macro quote field list; UI-specific country/filter interactions still open |
| Yield curves runtime probes | `docs/tradingview-yield-curves-runtime-probes-2026-05-07.md` | verified for default public component-data, browser-rendered US table, direct public AU/DE/JP non-US yield quotes over `data.tradingview.com`, direct public AU/DE/JP 10Y daily history over `resolve_symbol`/`create_series`, guest Add Country promo gate, guest settings menu state, and bundle-derived Add Country/settings/clone/delete/storage paths; simple country query/path/hash guesses classified as misses |
| Widget/embed runtime inventory | `docs/tradingview-widgets-embed-runtime-2026-05-07.md` | verified for public docs routes, S3 embed scripts, iframe shells, runtime host globals, and selected entry-bundle API leads; interactive frame schemas still open |
| Widget browser runtime capture | `docs/tradingview-widget-browser-runtime-capture-2026-05-07.md` | verified for representative public widget XHR/WebSocket hosts and frame methods across advanced-chart, screener, stock-heatmap, market-overview, timeline, events, technical-analysis, and symbol-info; also captures stock screener/heatmap scanner bodies, forex/crypto/crypto-market/futures/bonds screener widget bodies, technical-analysis scanner fields, Widget Sheriff validation/method behavior, timeline SSR init-data news rows, populated chart-events Reuters schema, populated economic-calendar related-history schema, Advanced Chart `set-symbol` parent postMessage behavior, and bundle-verified `set-interval -> setResolution` behavior |
| Preserve robust failure classes | failure sections across rediscovery/direct/product/shell artifacts classify auth, shape, invocation, network, endpoint mismatch, root-path absence, and observed-open-idle | verified |
| Push all work | commits through this audit's latest committed state; `git status --short --branch` should be clean and tracking `origin/main` after the session close push | verified after session close |

## Surface Coverage Matrix

| Surface family | Current evidence | Remaining gap |
| --- | --- | --- |
| Chart WebSocket | direct probes plus browser chart capture | replay UI, deep backtesting UI, authenticated/pro payload schemas, charts-polygon intended trigger |
| History/deep backtesting | `history-data` host live in direct probe and chart HTML evidence | browser deep-backtesting UI frames |
| Pushstream | public WebSocket opens idle in browser chart capture | channel triggers and message schema |
| Alerts | alert list/offline reads captured; no-cookie auth gates proven | create/edit/delete mutations and alert fire log details |
| News alerts/notifications | static leads and pushstream/news notification leads | notification channel capture and management flows |
| Watchlists | all/colored auth-gated; custom/default public; HAR read shapes | authenticated watchlist CRUD and user inventory schema |
| Chart storage/layouts | JWT-bearing read paths captured; payloads empty | non-empty layout/source schema and save/update/delete mutations |
| Drawings | telemetry and static line-tool/favorite-drawing leads | actual drawing storage read/write endpoints |
| Chart token/screenshots | HAR shape and no-cookie missing-field 400 | paired valid-shape auth probe |
| Options | first-load public scanner-backed shape captured | underlying/expiry interactions, strategy builder/finder, volatility chart, options-charting endpoints |
| Portfolio | static/service leads only | authenticated UI/runtime capture |
| Paper trading | static/service leads only | authenticated read-only account/panel capture; no order placement without explicit approval |
| Brokers | broker panel metadata public | authenticated hidden/region/entitlement differences |
| Pine facade | list, versions, translate, eval are public for probed shapes; script-info 401 | authenticated script-info behavior and user/private script shape |
| Pine Screener | public page, bundle transport path, sign-in UI gate, derived scan request body, no-cookie auth/header gate | authenticated UI capture to distinguish login, feature flag, and plan entitlement |
| Generic scanner | Worker has generic scan; many product scanner shapes captured | first-class product model and response schemas |
| Screener persistence | static facade/storage/API v2 screen leads | save/autosave UI capture |
| Heatmaps | stock/ETF/crypto runtime public scanner feeds | response schemas and interaction changes |
| CEX/DEX/Bond/ETF screeners | first-load runtime scan/metainfo/enum captured | saved views, interactions, response schema detail |
| Economic calendar | public events endpoint, economic-calendar event row schema, related-history schema, and scanner calendars captured | edge filters and UI-specific interaction variants |
| IPO/markets earnings/related bonds | exact no-cookie HAR body replay works | formal response schema sketches |
| Yield curves | component-data endpoint public; default US browser table rendered; simple country query/path/hash guesses classified as misses; `available_countries` exposes 48 country term-symbol maps; direct no-cookie WebSocket quote probe returned `qsd ok` for AU/DE/JP current yield symbols; direct no-cookie chart WebSocket probe returned `symbol_resolved`, `timescale_update`, and `series_completed` with 10 daily bars for AU/DE/JP 10Y symbols; guest Add click opens a registration promo and does not open country selection; guest settings menu exposes key-tenors, tenor/linear scale, and heatmap mode without yield localStorage writes; bundle shows Add Country and Clone use `runOrSigninWithFeature`, settings key `YieldCurves` persists only when authenticated, and reducer actions cover add/modify/toggle/clone/remove | authenticated Add Country picker/frames, authenticated settings persistence, and authenticated clone/delete persistence |
| Macro maps | component-data shell public; decompiled ChartApi quote/series data path; browser runtime capture for default `IRYY` indicator quote snapshots over `data.tradingview.com`; direct public probes for non-default indicator quote snapshots, GDP historical series frames, and macro quote field list | UI-specific filter-only indicator behavior, country group switch behavior, exact country-code list changes, and historical slider event sequencing |
| Fundamentals | fundamentals config and scanner symbol public | response schema consolidation |
| News mediator / timeline news | public HAR/runtime news flow, symbol view, and timeline widget SSR init-data rows | Worker parity planning vs existing news-headlines route; optional timeline pagination/filtering if present |
| Ideas/Minds/community | existing Worker partial support and static leads | broader authenticated/community interactions |
| Chats/support | support unread auth-gated; chats cookie-observed | scope decision and authenticated schemas |
| Widgets/embeds | route patterns, widgetdata WebSocket evidence, public docs route inventory, S3 external-embedding scripts, 19 no-cookie iframe shells, runtime host matrix, Advanced Chart postMessage leads, screener widget product-family leads, representative browser XHR/WebSocket capture for eight widget families, timeline SSR init-data news rows, stock screener/heatmap scanner body shapes, forex/crypto/crypto-market/futures/bonds screener widget body shapes, technical-analysis scanner fields, Widget Sheriff valid/malformed/missing-origin and method semantics, populated chart-events Reuters schema, populated economic-calendar related-history schema, Advanced Chart `set-symbol` parent `quoteUpdate` behavior, and bundle-verified `set-interval -> setResolution` behavior | remaining Advanced Chart socket-frame postMessage deltas, optional timeline pagination/filtering, interaction-driven widget scanner deltas, and Worker modeling decision |
| Mobile/desktop app surfaces | public web/bundle evidence only | not covered; needs mobile/desktop traffic capture if in scope |

## Completion Decision

The objective is not complete.

The rediscovery has strong public, HAR, direct-probe, browser-runtime, WebSocket, product, shell-page, and parallel-discovery coverage, but the following requirements remain unverified:

- Authenticated browser state for account-gated read surfaces.
- Explicit approval and rollback plan for mutation probes: alerts, watchlists, layouts, drawings.
- Replay and deep-backtesting UI WebSocket frame capture.
- Portfolio and paper trading runtime capture.
- Pine Screener authenticated/feature/plan behavior after the scan body is now derived.
- Macro maps remaining UI-specific interaction frames: filter-only indicators, country group switch behavior, exact country-code list changes, and historical slider event sequencing.
- Charts-polygon intended trigger.
- Yield curves remaining authenticated Add/settings/clone/delete persistence.
- Widget/embed remaining controlled interaction schemas, interaction-driven scanner deltas, and Worker modeling after representative public browser runtime capture.
- Mobile/desktop app traffic, if the objective includes non-web TradingView clients.

## Required Next Input

To continue beyond the safe public/no-cookie frontier, the next required input is one of:

1. A logged-in TradingView browser profile/session that can be reused for read-only authenticated captures.
2. Explicit approval for safe disposable mutation probes, with rollback constraints, for alerts/watchlists/layouts/drawings.
3. Permission to spend further deeper decompilation passes on selected bundles and produce only compact derived request-builder evidence.
4. A scoped decision that mobile/desktop client traffic is in or out of this rediscovery objective.

Until one of those is available, the remaining gaps are blocked by access, mutation authorization, or deeper reverse-engineering scope rather than ordinary public probing.
