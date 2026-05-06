# TradingView Surface Rediscovery

Use this reference when the user asks to rediscover TradingView capabilities, check whether TradingView changed, expand Worker coverage, or investigate unknown unknowns.

## Premise

This is not a normal gap audit. The core problem is that we do not know what we do not know. Start from the current Worker/core/skill baseline, then aggressively expand beyond it before proposing implementation.

## Objective

Rediscover all TradingView surfaces, including hidden, indirect, plan-gated, bundle-only, WebSocket-only, browser-state-dependent, undocumented, deprecated-but-still-live, and feature-flagged surfaces.

## Explore First

Inspect TradingView like a reverse engineer:

- Browser network traffic.
- WebSocket frames and chart-session messages.
- Bundled JavaScript, route manifests, source maps when present, static assets, feature flags, schema strings, endpoint literals, and message names.
- REST, GraphQL, scanner, calendar, news, fundamentals, search, Pine/editor, layout, watchlist, alert, replay, social/community, options, widgets, and embed surfaces.
- Authenticated and unauthenticated behavior separately.
- Failed, 403, 404, rate-limited, and plan-gated requests as evidence, not noise.

Explore multiple UI paths:

- Chart pages, symbol pages, screeners, heatmaps, calendars, news, ideas, minds/social, Pine editor, indicators, strategy tester, alerts, watchlists, layouts, replay, options, profile/account areas, widgets, and embed surfaces.

Continue exploring until marginal discoveries flatten. A report that only validates existing Worker routes or obvious TradingView APIs is a failure.

## Parallel Discovery Lanes

For a broad rediscovery pass, set up parallel discovery with ten specialized agents or work lanes. Each lane owns one distinct surface family and receives the same evidence pack:

- The sanitized HAR summary plus the local sensitive HAR path when the worker is allowed to inspect it.
- Unauthenticated browser/runtime captures, including raw request logs when available.
- Worker authority files: `worker/`, `packages/tradingview-core/`, `worker/openapi.yaml`, and this skill.
- Permission to mine unknown unknowns from bundles, manifests, route chunks, WebSocket frames, feature flags, and invisible request builders.

Lanes:

1. Chart/session/WebSocket protocol, replay, deep backtesting, drawing/storage side channels.
2. Scanner, screeners, heatmaps, options, product-specific scanner labels, metainfo, enum endpoints.
3. Pine, Pine facade, indicators, studies, Pine Screener, script metadata, eval/translate flows.
4. Alerts, notifications, pushstream, support unread, fire logs, delivery controls.
5. Watchlists, layouts, chart storage, drawings, study templates, symbol lists.
6. Calendars, fundamentals, macro maps, yield curves, seasonals, forward curves, economic data.
7. News, ideas, community, chats, minds/social, profile/content surfaces.
8. Brokerage, paper trading, portfolios, trading panel, order/account runtime paths.
9. Widgets, embeds, static charting library, public widget hosts, iframe/postMessage surfaces.
10. Authentication, plan gates, feature flags, account/session state, mobile/desktop app-only traffic.

Each lane must distinguish unauthenticated, authenticated, plan-gated, feature-flagged, shape-gated, network/upstream, and invocation failures. Network/upstream/rate-limit failures are retryable evidence, not capability downgrades; keep retrying or record them as unresolved transport state. Auth failures should preserve the strongest observed credential shape rather than falling back to weaker unauthenticated behavior.

## Unknown-Unknown Discipline

- Do not assume TradingView's visible UI equals its available integration surface.
- Do not assume current Worker routes represent the useful boundary.
- Do not assume endpoint names explain behavior.
- Do not discard failed or gated requests; classify them.
- Do not collapse network, upstream, rate-limit, auth, and plan-gated failures together.
- Do not call a surface absent unless runtime traffic, bundles, and relevant UI paths were searched.
- Preserve signed session material. Do not downgrade from `sessionid` plus `sessionid_sign` to `sessionid` only.

## Surface Record

For each discovered surface, record:

- Name.
- Category.
- Transport: REST, WebSocket, browser-only, bundle-only, or mixed.
- Evidence source: network request, WebSocket frame, JavaScript bundle, route manifest, DOM action, or current repo source.
- Endpoint, message, route, or string.
- Triggering UI path or code path.
- Auth requirement.
- Plan or permission gate, if observed.
- Inputs.
- Outputs.
- Failure modes and recovery behavior.
- Current repo support: full, partial, absent, or stale.
- Confidence: verified, inferred, or lead only.
- Next probe needed.

## Compare Against Repo Authority

Use the repo as a baseline, not a boundary:

- Runtime authority: `worker/`.
- Shared protocol/constants/types authority: `packages/tradingview-core/`.
- API contract: `worker/openapi.yaml`.
- Procedural skill authority: `skills/tradingview/`.

Identify missing surfaces, stale assumptions, duplicated authority, partial support, and places where current code loses capability or recovery context.

## Deliverables

- Exploration log showing where you looked and what each path revealed.
- Comprehensive surface inventory table.
- Hidden and lead-only surface list for follow-up probing.
- Gap analysis against `worker/`, `packages/tradingview-core/`, `worker/openapi.yaml`, and `skills/tradingview/`.
- Prioritized implementation roadmap grouped into reviewable commits.
- Verification probes for each high-value surface, including positive and negative checks.
- Explicit unknowns that remain and what account access, browser login, plan access, live credentials, or runtime proof would be required to resolve them.
