# Worker architecture

The Worker is the only runtime that touches TradingView. Everything else (this skill, dev tools, downstream consumers) reaches TradingView through it.

## Layers

```
caller ──HMAC──> Cloudflare Worker (Hono)
                  │
                  ├── packages/tradingview-core (protocol/math/types)
                  ├── CACHE_META   (KV: admin session, cache index, totals)
                  ├── CACHE_DATA   (R2: candle chunks, large blobs)
                  ├── FetchCoordinator (Durable Object: in-flight dedup)
                  └── upstreams
                       ├── data.tradingview.com / prodata / widgetdata / charts-polygon  (WSS)
                       ├── pricealerts.tradingview.com  (REST, cookie-auth)
                       ├── pushstream.tradingview.com  (WSS, alert delivery)
                       ├── www.tradingview.com  (chart-api, pubscripts, study-templates, drawing-templates)
                       ├── pine-facade.tradingview.com  (Pine compile, list, CRUD)
                       └── scanner / symbol_search / news / minds / ideas
```

## HMAC mechanics

`packages/tradingview-core/src/hmac.ts` is the canonical signer. Canonical string:

```
<METHOD>\n<path-with-query>\n<sha256-hex(body)>\n<unix-timestamp>
```

Header names: `X-Worker-Auth-Timestamp`, `X-Worker-Auth-Signature`. Window: ±5 minutes. The Worker fails closed when `WORKER_HMAC_SECRET` is not configured — never let a route accept unauthenticated traffic.

## Admin session store

KV key: `admin:session`. Value: `{ sessionId, sessionSign, username, userId, privateChannel, blockedUntil?, lastSuccessAt?, lastFailureAt? }`.

Precedence inside `resolveSession`:

1. Caller-provided `sessionId` + `sessionSign` (debug-only).
2. Stored admin session if not blocked.
3. None — the route runs unauthenticated. For authenticated-tier routes, throw before reaching upstream.

Caller precedence is a privilege; callers should never use it in production. The Worker logs precedence so misuse is auditable.

`POST /admin/session` writes the store. `POST /admin/session/unblock` clears the block-until timer. `GET /admin/session/status` returns redacted state. Never log `sessionid_sign` or full cookies.

## Storage

| Surface | Purpose | Key shape | Lifetime |
| --- | --- | --- | --- |
| `CACHE_META` (KV) | Admin session, cache chunk index, totals, cooldowns | `admin:session`, `cache:<symbol>:<tf>:index`, `totals` | Cleared by `cache/{symbol}/{tf}/invalidate` |
| `CACHE_DATA` (R2) | Candle chunk bodies | `cache/<symbol>/<tf>/<chunk>` | Same |
| `FetchCoordinator` (DO) | In-flight request dedup for hot keys | per-namespace ID | Per request |

## Error envelope

All `/v1/*` errors return `{error, category, retryable, upstreamStatus?, upstreamError?, details?}`. `category` is the only field the caller should branch on for retry decisions:

| Category | Meaning | Retry posture |
| --- | --- | --- |
| `auth` | HMAC bad, admin session missing or expired | Do not retry. Refresh session, then retry. |
| `validation` | Body missing required field, wrong shape | Do not retry. Fix request. |
| `network` | Worker → upstream socket failed | Retry with backoff, same session. |
| `upstream` | Upstream returned 5xx or malformed payload | Retry with backoff, same session. |
| `rate_limit` | Upstream returned 429 or cooldown | Retry with backoff respecting `Retry-After`. |
| `internal` | Worker bug | Do not retry. File a beads bug. |

`partial:true` on cache responses means the chunk index has gaps; the included `upstreamError` is the original upstream failure. Retry only if `retryable:true`.

## FetchCoordinator (Durable Object)

Hot keys (e.g., a symbol fanning out to many candle requests) are coalesced behind a per-key DO instance so only one upstream fetch runs at a time. Callers see the response of whatever fetch was already in flight. The DO has no persistent state beyond the lifetime of a single coalesced fetch.

A future, deferred DO (P9 in the rediscovery roadmap, bead `tradingview-2v6`) owns long-lived chart sessions for `modify_study`, study-on-study, and replay-driven streaming. Today's worker opens one chart WebSocket per request and tears it down after `study_completed`.

## WebSocket lifecycle

Per-request, no persistent connection from Worker to TradingView. The flow inside `runStudy` / `getCandles` / `runReplay`:

```
connect (WSS upgrade with sessionid cookie) →
set_auth_token →
chart_create_session →
resolve_symbol →
create_series  (for any data flow) →
create_study   (for indicator/strategy flow) →
collect frames (timescale_update / du / study_completed / ...) →
chart_delete_session →
close
```

Read `wire-formats.md` for the framer (`~m~N~m~{json}`) and the `create_study` 6-arg encoding.

## Pushstream

`wss://pushstream.tradingview.com/message-pipe-ws/private_<TOKEN>` — alert delivery. The Worker either proxies it to callers via a server-sent stream or polls `/get_offline_fires` on demand. There is no per-topic subscribe; users get their entire private channel.

## Endpoint mirrors

Cloudflare Workers cannot keep a long-lived TCP connection across regions. Each request lands on the closest colo and opens a fresh WSS to TradingView. There is no shared connection pool. Cache via KV/R2 instead of trying to reuse sockets.
