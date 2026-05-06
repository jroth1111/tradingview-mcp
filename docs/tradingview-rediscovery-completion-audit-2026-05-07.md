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
| Preserve robust failure classes | failure sections across rediscovery/direct/product/shell artifacts classify auth, shape, invocation, network, endpoint mismatch, root-path absence, and observed-open-idle | verified |
| Push all work | commits through `5d86bf3`; `git status --short --branch` clean and tracking `origin/main` | verified |

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
| Pine Screener | public page, bundle transport path, sign-in UI gate | scan request body via authenticated UI or deeper decompilation |
| Generic scanner | Worker has generic scan; many product scanner shapes captured | first-class product model and response schemas |
| Screener persistence | static facade/storage/API v2 screen leads | save/autosave UI capture |
| Heatmaps | stock/ETF/crypto runtime public scanner feeds | response schemas and interaction changes |
| CEX/DEX/Bond/ETF screeners | first-load runtime scan/metainfo/enum captured | saved views, interactions, response schema detail |
| Economic calendar | public events endpoint and scanner calendars captured | response schema detail and edge filters |
| IPO/markets earnings/related bonds | exact no-cookie HAR body replay works | formal response schema sketches |
| Yield curves | component-data endpoint public | parameter exploration and country/settings changes |
| Macro maps | component-data shell public | populated indicator/timestamp data request path |
| Fundamentals | fundamentals config and scanner symbol public | response schema consolidation |
| News mediator | public HAR/runtime news flow and symbol view | Worker parity planning vs existing news-headlines route |
| Ideas/Minds/community | existing Worker partial support and static leads | broader authenticated/community interactions |
| Chats/support | support unread auth-gated; chats cookie-observed | scope decision and authenticated schemas |
| Widgets/embeds | route patterns and widgetdata WebSocket evidence | exhaustive widget API inventory |
| Mobile/desktop app surfaces | public web/bundle evidence only | not covered; needs mobile/desktop traffic capture if in scope |

## Completion Decision

The objective is not complete.

The rediscovery has strong public, HAR, direct-probe, browser-runtime, WebSocket, product, shell-page, and parallel-discovery coverage, but the following requirements remain unverified:

- Authenticated browser state for account-gated read surfaces.
- Explicit approval and rollback plan for mutation probes: alerts, watchlists, layouts, drawings.
- Replay and deep-backtesting UI WebSocket frame capture.
- Portfolio and paper trading runtime capture.
- Pine Screener scan body.
- Macro maps populated runtime data.
- Charts-polygon intended trigger.
- Exhaustive widget/embed inventory.
- Mobile/desktop app traffic, if the objective includes non-web TradingView clients.

## Required Next Input

To continue beyond the safe public/no-cookie frontier, the next required input is one of:

1. A logged-in TradingView browser profile/session that can be reused for read-only authenticated captures.
2. Explicit approval for safe disposable mutation probes, with rollback constraints, for alerts/watchlists/layouts/drawings.
3. Permission to spend a deeper decompilation pass on selected bundles and produce only compact derived request-builder evidence.
4. A scoped decision that mobile/desktop client traffic is in or out of this rediscovery objective.

Until one of those is available, the remaining gaps are blocked by access, mutation authorization, or deeper reverse-engineering scope rather than ordinary public probing.
