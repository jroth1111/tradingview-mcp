# Parallel Surface Discovery Prompt

Use this prompt when setting up a broad TradingView rediscovery wave. The aim is to expose unknown unknowns, not merely confirm known Worker routes.

## Coordinator Prompt

You are one lane in a 10-lane TradingView surface rediscovery wave. Your job is to rediscover every visible and invisible surface in your assigned family, including unknown unknowns.

Inputs available:

- Sanitized HAR summaries and, if explicitly allowed, the local sensitive HAR path `/Users/gwizz/Downloads/www.tradingview.com.har`.
- Unauthenticated browser/runtime artifacts, including raw request logs when available.
- Worker authority files: `worker/`, `packages/tradingview-core/`, `worker/openapi.yaml`, and `skills/tradingview/`.
- Current rediscovery docs under `docs/tradingview-*.md`.
- Permission to mine unknown unknowns from JavaScript bundles, route manifests, source maps when present, WebSocket frames, feature flags, string tables, static assets, and invisible request builders.

Hard rules:

- Do not mutate TradingView account state or call create/update/delete endpoints unless the coordinator has provided explicit approval plus rollback constraints.
- Do not commit cookies, JWTs, session ids, signed values, account ids, or raw HAR content.
- Distinguish unauthenticated, authenticated-observed, authenticated-required, plan-gated, feature-flagged, shape-gated, invocation-failed, network/upstream/rate-limited, and lead-only evidence.
- Do not downgrade capability because a network, DNS, rate-limit, or upstream failure occurred. Classify it as retryable transport state and preserve the strongest observed surface lead.
- Do not downgrade authenticated capability to unauthenticated just because unauthenticated probing fails. Preserve the credential shape and retry authenticated capture when access exists.
- Failed requests are evidence. Record host, path, method, status, body/query key shape, triggering UI/code path, and failure class.
- Search visible UI paths and invisible bundle/runtime paths. Treat TradingView's current Worker coverage as baseline evidence, not a boundary.

For your assigned family, produce:

1. Surface inventory with transport, host/path/message, trigger, inputs, outputs, auth requirement, failure modes, and confidence.
2. Unknown-unknown leads from bundles, manifests, feature flags, route strings, message names, and request builders.
3. Auth split: what is proven unauthenticated, what is authenticated-observed, what is authenticated-required, and what remains auth-unknown.
4. Worker gap analysis against `worker/`, `packages/tradingview-core/`, `worker/openapi.yaml`, and `skills/tradingview/`.
5. Robustness notes: how to distinguish source failures from invocation, network/upstream, auth, plan-gate, and shape failures; what can be retried automatically.
6. Next probes, with positive and negative checks, including which account/session/plan/browser state is required.

## Ten Lane Ownership Map

1. Chart/session/WebSocket protocol, replay, deep backtesting, drawings/storage side channels.
2. Scanner, screeners, heatmaps, options, product-specific scanner labels, metainfo, enum endpoints.
3. Pine, Pine facade, indicators, studies, Pine Screener, script metadata, eval/translate flows.
4. Alerts, notifications, pushstream, support unread, fire logs, delivery controls.
5. Watchlists, layouts, chart storage, drawings, study templates, symbol lists.
6. Calendars, fundamentals, macro maps, yield curves, seasonals, forward curves, economic data.
7. News, ideas, community, chats, minds/social, profile/content surfaces.
8. Brokerage, paper trading, portfolios, trading panel, order/account runtime paths.
9. Widgets, embeds, static charting library, public widget hosts, iframe/postMessage surfaces.
10. Authentication, plan gates, feature flags, account/session state, mobile/desktop app-only traffic.

## Recovery And Retry Policy

If a probe fails, classify before changing the probe or downgrading the surface:

- `network/upstream`: DNS, timeout, TLS, 5xx, connection reset, rate limit, or service outage. Retry with backoff; keep the surface open.
- `auth`: explicit missing/invalid credential, missing user id, missing signed token, login wall, or account-required body error. Preserve credential shape and rerun with authenticated state.
- `plan/feature`: entitlement, feature flag, region, product, or plan gate. Record gate text/field and required state.
- `shape/invocation`: 400/404/422 caused by wrong method, missing required key, wrong root symbol, wrong product route, malformed origin, or body mismatch. Repair shape from bundle/HAR/runtime evidence and retry.
- `source`: the upstream contract is proven different from repo assumptions or Worker implementation. Record exact counterexample and propose Worker/core changes.

Do not call a surface absent until runtime traffic, bundles, relevant UI paths, and auth-vs-unauth shape have all been checked or explicitly recorded as unavailable.
