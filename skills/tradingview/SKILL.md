---
name: tradingview
description: Use the TradingView Cloudflare Worker to fetch market data, run indicators and Pine, screen markets, manage alerts, run strategy backtests, and apply study/drawing templates. The Worker is the only runtime authority; this skill is workflow prose plus reference docs.
---

# TradingView skill

Use this skill when a user wants market data, technical analysis, scanner output, indicator metadata, Pine compile/run loops, strategy backtests, alert CRUD/delivery, study or drawing templates, or any TradingView surface reachable through the Worker.

## Mission

Translate a user intent into the smallest correct sequence of Worker calls, choose the right workflow, and report results with `authSource`, retry semantics, and any source/plan/cache caveats preserved.

## Runtime Authority

The single architectural rule:

There is exactly one runtime: the deployed Cloudflare Worker described by `worker/openapi.yaml`.

- The Worker terminates every TradingView upstream — REST, WebSocket data feed, pushstream alert delivery, pricealerts REST, pubscripts, study-templates, pine-facade. It fails closed when HMAC configuration or auth checks are missing.
- Shared protocol/types/math live in `packages/tradingview-core/`. Read it; do not duplicate constants here or anywhere else.
- This skill carries workflow prose and reference documentation only. Do not add local clients, MCP tools, secret JSON stores, or TradingView protocol constants in the skill tree.
- Caller-supplied `sessionId`/`sessionSign` is a debugging escape hatch. Production use the Worker admin session store; never let caller-provided session take precedence over stored session.

## Authentication tiers

Two tiers gate every route. HMAC-SHA256 request signing is required on all `/v1/*` routes; tier (`public` vs `authenticated`) refers to whether TradingView upstream needs a logged-in browser session.

| Tier | What gates it | Examples |
| --- | --- | --- |
| Public | HMAC only | `/v1/candles`, `/v1/quotes`, `/v1/search`, `/v1/scan`, `/v1/news`, `/v1/fundamentals`, `/v1/indicators/search`, `/v1/indicators/builtin`, `/v1/pubscripts/library`, `/v1/ta`, `/v1/calendar/*` |
| Authenticated | HMAC + Worker admin session present (`sessionid` + `sessionid_sign` cookies) | `/v1/study`, `/v1/pine/*`, `/v1/strategy/*`, `/v1/indicators/private`, `/v1/alerts/*`, `/v1/study-templates/*`, `/v1/drawing-templates/*`, `/v1/me`, `/v1/ideas`, `/v1/minds`, deep history, realtime data |

If an authenticated route returns `category:"auth"`, check `GET /admin/session/status` and refresh the admin store before retrying. Never fall back to unauthenticated behavior on auth failures — fail and surface the issue.

Read `auth.md` before making authenticated requests for the HMAC signing details and the admin session API.

## Capability matrix

Each row is one user intent. For deep schemas read the linked reference doc.

| Intent | Route | Auth | Workflow | Reference |
| --- | --- | --- | --- | --- |
| Resolve a ticker | `POST /v1/search` | public | `analyze-stock.md` | `endpoints.md` |
| OHLC bars | `POST /v1/candles` | public | `analyze-stock.md` | `endpoints.md` |
| Deep history | `POST /v1/backfill` | authenticated | `analyze-stock.md` | `endpoints.md` |
| Live quotes | `POST /v1/quotes` | public | `analyze-stock.md` | `endpoints.md` |
| Built-in indicator catalog | `GET /v1/indicators/builtin` | public | `list-indicators.md` | `indicators.md` |
| Search public scripts | `POST /v1/indicators/search`, `GET /v1/pubscripts/library` | public | `list-indicators.md` | `indicators.md` |
| Indicator metadata | `POST /v1/indicators/meta` | public | `indicator-evaluate.md` | `indicators.md` |
| Typed indicator inputs | `GET /v1/indicators/inputs/{id}` | public | `indicator-evaluate.md` | `indicators.md` |
| Run an indicator | `POST /v1/study` | authenticated | `indicator-evaluate.md` | `wire-formats.md`, `indicators.md` |
| Download indicator source / compiled artifact | `POST /v1/pubscripts/batch` or `/suggest` (`scriptSource`, open-source `PUB;`) → `POST /v1/indicators/meta` (`IL`/`ilTemplate`, any accessible indicator) | public for open; authenticated for UOI/private | `download-indicator-source.md` | `indicators.md` |
| List private scripts | `POST /v1/indicators/private` | authenticated | `list-indicators.md` | `indicators.md` |
| Pine compile (eval/full/light) | `POST /v1/pine/compile` | authenticated | `pinescript-iterate.md` | `pinescript.md` |
| Pine run | `POST /v1/pine/run` | authenticated | `pinescript-iterate.md` | `pinescript.md`, `wire-formats.md` |
| Save Pine source | `POST /v1/pine/save` | authenticated | `save-pine-script.md` | `pinescript.md` |
| Strategy backtest | `POST /v1/strategy/run` | authenticated | `backtest-strategy.md`, `indicator-to-strategy-backtest.md` | `strategies.md` |
| Closed-source backtest | `POST /v1/strategy/run` with `pineId` reference | authenticated | `backtest-closed-source.md` | `strategies.md` |
| TA snapshot | `POST /v1/ta`, `POST /v1/ta/summary` | public | `analyze-stock.md` | `endpoints.md` |
| Screener | `POST /v1/scan` | public | `screen-to-idea.md` | `endpoints.md` |
| Sector / industry movers | `POST /v1/markets/sector-movers`, `industry-movers`, `overview` | public | `screen-to-idea.md` | `endpoints.md` |
| Options snapshot | `POST /v1/quotes` (options chain) | public | `options-snapshot.md` | `endpoints.md` |
| News + content | `POST /v1/news`, `POST /v1/news/content` | public | `analyze-stock.md` | `endpoints.md` |
| Earnings / dividends | `POST /v1/calendar/earnings`, `dividends` | public | `analyze-stock.md` | `endpoints.md` |
| Fundamentals | `POST /v1/fundamentals` | public | `analyze-stock.md` | `endpoints.md` |
| Ideas / Minds | `POST /v1/ideas`, `POST /v1/minds` | authenticated (or public read) | `analyze-stock.md` | `endpoints.md` |
| Replay backfill | `POST /v1/replay` | authenticated | `analyze-stock.md` | `endpoints.md` |
| Movers (gainers/losers) | `POST /v1/movers` | public | `screen-to-idea.md` | `endpoints.md` |
| Create alert on study | `POST /v1/alerts/create-on-study` | authenticated | `set-up-alert.md` | `alerts.md` |
| Create Pine alert | `POST /v1/alerts/create-pine` | authenticated | `set-up-alert.md` | `alerts.md` |
| List/modify/delete alerts | `GET /v1/alerts`, `POST /v1/alerts/{stop,restart,delete,clone,modify}` | authenticated | `set-up-alert.md` | `alerts.md` |
| Alert fire history | `GET /v1/fires`, `POST /v1/fires/clear` | authenticated | `monitor-alerts.md` | `alerts.md` |
| Live alert delivery | `WSS /v1/alerts/stream` (pushstream proxy) | authenticated | `monitor-alerts.md` | `alerts.md` |
| List study templates | `GET /v1/study-templates` | authenticated | `apply-study-template.md` | `templates.md` |
| Save / rename / delete study template | `POST/PUT/DELETE /v1/study-templates/{id}` | authenticated | `apply-study-template.md` | `templates.md` |
| Drawing templates | `GET/POST/DELETE /v1/drawing-templates/{tool}/{name?}` | authenticated | `apply-study-template.md` | `templates.md` |

If the intent is not on this matrix, run `surface-rediscovery.md` before extending the Worker.

## Common request shape

Every `/v1/*` request:

```
POST /v1/<route> HTTP/1.1
Host: <worker-host>
Content-Type: application/json
X-Worker-Auth-Timestamp: <unix-seconds>
X-Worker-Auth-Signature: hex(hmac_sha256(SECRET, "<METHOD>\n<path>?<query>\n<sha256(body)>\n<timestamp>"))
```

Body is JSON. Use `bars`, `limit`, or date ranges to bound result size; start small.

## Common response shape

Success:

```json
{ "result": <route-specific>, "authSource": "stored" | "provided" | "none" }
```

`authSource` is present on every session-aware route. Always preserve it in your final report.

Error envelope:

```json
{
  "error": "<short>",
  "category": "auth" | "network" | "upstream" | "rate_limit" | "validation" | "internal",
  "retryable": true | false,
  "upstreamStatus": <number?>,
  "upstreamError": <string?>,
  "details": <object?>
}
```

Cache responses can include `partial: true` plus `upstreamError`; treat as incomplete coverage.

## Request pattern

1. Resolve ambiguous symbols with `POST /v1/search` first.
2. Prefer the Worker admin session store. Do not pass caller `sessionId` unless explicitly debugging.
3. Bound the request — small `bars`, `limit`, or date window first; widen only if needed.
4. On `retryable:true` with `category:"network" | "upstream" | "rate_limit"`, retry with backoff. Preserve the stored session. Do not rotate credentials.
5. On `category:"auth"`, check `GET /admin/session/status`. Refresh the admin session if stale; otherwise surface the auth error. Never silently fall back.
6. Preserve `authSource` (`stored` | `provided` | `none`) on every report.
7. On `partial:true` cache responses, retry only if `upstreamError.retryable` is true; otherwise report incomplete coverage.

When a Worker route is unimplemented or buggy, file a beads issue (`bd create --type=bug ...`) instead of writing a local fallback client.

## Workflows

Pick by intent. Each workflow is a step-by-step recipe.

- `workflows/analyze-stock.md` — single-symbol research (search → candles → quotes → TA → news/fundamentals).
- `workflows/screen-to-idea.md` — screener → top ideas → drilldowns.
- `workflows/options-snapshot.md` — option chain snapshot via quotes.
- `workflows/list-indicators.md` — discover built-in / public / private indicators.
- `workflows/indicator-evaluate.md` — run a built-in or public indicator on a symbol.
- `workflows/pinescript-iterate.md` — author Pine, compile, run, refine.
- `workflows/save-pine-script.md` — persist Pine source as draft / saved / published.
- `workflows/backtest-strategy.md` — run a strategy with custom properties, get report + trades + equity.
- `workflows/indicator-to-strategy-backtest.md` — convert an indicator into a strategy and backtest.
- `workflows/backtest-closed-source.md` — backtest a closed-source strategy via reference (`is_auth_to_get`).
- `workflows/set-up-alert.md` — create a study, Pine, or price alert with channels and frequency.
- `workflows/monitor-alerts.md` — list alerts, stream live fires, drain offline backlog.
- `workflows/apply-study-template.md` — list / save / load / favorite study or drawing templates.
- `surface-rediscovery.md` — periodic remap of TradingView surfaces before extending the Worker.

## Reference

Schema-level deep dives. Read on demand from a workflow.

- `reference/architecture.md` — Worker layers, HMAC, admin session store, KV/R2/DO, error envelope.
- `reference/capabilities.md` — full unauth-vs-auth capability table with plan-gating notes.
- `reference/endpoints.md` — every Worker route with status flags (live / bug / deferred), method, body, error mapping.
- `reference/wire-formats.md` — TradingView WebSocket framing, `create_study` / `modify_study` 6-arg shape, `du` accumulation, pushstream frames.
- `reference/indicators.md` — `STD;` / `PUB;` / `USER;` namespaces, `StudyInputType` enum, source/symbol input encoding, metadata fetch.
- `reference/pinescript.md` — Pine compile pipeline (`eval_pine_ex` / `translate_source` / `translate_light`), save/publish/delete CRUD.
- `reference/alerts.md` — alert object schema (~30 keys), condition types, frequencies, webhook tokens, pushstream delivery.
- `reference/strategies.md` — property fields, report fields, trade rows, equity arrays, closed-source via `is_auth_to_get`.
- `reference/templates.md` — study-templates and drawing-templates surfaces, apply-flow client-side semantics.
- `reference/parallel-surface-discovery-prompt.md` — 10-lane unknown-unknown rediscovery prompt with auth/unauth and retry classification rules.

## Recon archive

Surface rediscovery output lives under `recon/` keyed by date. The most recent unified report is `recon/INDICATOR-RECON-2026-05-07.md`. Treat as historical evidence; the live source of truth remains the Worker plus this skill.
