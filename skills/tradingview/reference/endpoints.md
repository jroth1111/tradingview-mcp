# Worker endpoints (canonical list)

Authority: this list mirrors `worker/openapi.yaml` plus routes added during the 2026-05-07 surface rediscovery. Live status flags reflect what is reachable today.

Status legend:
- `live` — wired, returning real data.
- `bug` — wired but broken; bead link below.
- `pending` — designed in `recon/INDICATOR-RECON-2026-05-07.md`, bead open, not yet shipped.
- `deferred` — bead exists, paused.

## Health and admin

| Method | Path | Auth | Status | Purpose |
| --- | --- | --- | --- | --- |
| GET | `/health` | none | live | Readiness probe. |
| GET | `/admin/session/status` | HMAC | live | Redacted admin session state. |
| POST | `/admin/session` | HMAC | live | Write admin session (`{sessionId, sessionSign, username, userId, privateChannel}`). |
| POST | `/admin/session/unblock` | HMAC | live | Clear `blockedUntil` cooldown. |

## Cache ops

| Method | Path | Auth | Status | Purpose |
| --- | --- | --- | --- | --- |
| GET | `/cache/{symbol}/{tf}` | HMAC | live | Stitched candle slice. |
| GET | `/cache/{symbol}/{tf}/status` | HMAC | live | Index summary. |
| POST | `/cache/{symbol}/{tf}/invalidate` | HMAC | live | Drop chunks for a key. |
| POST | `/cache/snapshot` | HMAC | live | Bulk export. |
| POST | `/cache/restore` | HMAC | live | Bulk import. |
| GET | `/cache/selftest` | HMAC | live | Round-trip smoke test. |
| GET | `/cache/integration-test` | HMAC | live | Multi-key integration. |

## Market data

| Method | Path | Auth | Status | Body |
| --- | --- | --- | --- | --- |
| POST | `/v1/candles` | HMAC | live | `{symbol, timeframe, bars?, to?, sessionId?, sessionSign?}` |
| POST | `/v1/quotes` | HMAC | live | `{symbols[], fields[]?}` |
| POST | `/v1/replay` | HMAC + admin | live | `{symbol, timeframe, fromBar, bars}` |
| POST | `/v1/backfill` | HMAC + admin | live | `{symbol, timeframe?, total?, delayMs?}` |
| POST | `/v1/stream/bootstrap` | HMAC | live | Token + auth-token mint. |
| POST | `/v1/auth-token` | HMAC + admin | live | Internal token refresh. |

## Discovery and reference

| Method | Path | Auth | Status | Body |
| --- | --- | --- | --- | --- |
| POST | `/v1/search` | HMAC | live | `{q, exchange?, type?, limit?}` |
| POST | `/v1/resolve` | HMAC | live | `{symbol}` |
| POST | `/v1/scan` | HMAC | live | `{filter[], columns[], range?}` |
| POST | `/v1/movers` | HMAC | live | `{market, type:"gainers"|"losers"}` |
| POST | `/v1/markets/overview` | HMAC | live | `{market}` |
| POST | `/v1/markets/sector-movers` | HMAC | live | `{market, sort?}` |
| POST | `/v1/markets/industry-movers` | HMAC | live | `{market, sector, sort?}` |
| GET | `/v1/meta/markets` | HMAC | live | List markets. |
| GET | `/v1/meta/news` | HMAC | live | News categories. |
| GET | `/v1/meta/fundamentals` | HMAC | live | Field map. |
| GET | `/v1/meta/timeframes` | HMAC | live | Allowed timeframe codes. |

## Indicators

| Method | Path | Auth | Status | Body |
| --- | --- | --- | --- | --- |
| GET | `/v1/indicators/builtin` | HMAC | pending (bead `tradingview-ux7`) | `?filter, kind, q, fundamentalCategory` |
| POST | `/v1/indicators/search` | HMAC | live | `{q}` (built-ins + public merged) |
| POST | `/v1/indicators/meta` | HMAC | live | `{id, version?}` |
| GET | `/v1/indicators/inputs/{id}` | HMAC | pending (bead `tradingview-1n8`) | Typed inputs from metaInfo. |
| POST | `/v1/indicators/private` | HMAC + admin | live | List user-saved Pine. |
| POST | `/v1/study` | HMAC + admin | **bug (bead `tradingview-hd6`)** | `{symbol, studyId, inputs?, params?, timeframe?, bars?, parentSeriesId?}` — current code uses 3-arg `create_study` and never decodes `du`; produces empty data. |

## Pubscripts

| Method | Path | Auth | Status | Notes |
| --- | --- | --- | --- | --- |
| GET | `/v1/pubscripts/library` | HMAC | pending (bead `tradingview-2xa`) | `?offset, count, sort, type, is_paid` |
| GET | `/v1/pubscripts/editors-picks` | HMAC | pending | `?type` |
| POST | `/v1/pubscripts/batch` | HMAC | pending | `{ids[]}` → fans into `/pubscripts-get/`. |
| GET | `/v1/pubscripts/suggest` | HMAC | pending | `?q` |
| GET | `/v1/pubscripts/personal-access` | HMAC + admin | pending | Paid scripts the user has. |
| GET | `/v1/pubscripts/packages/store` | HMAC + admin | pending | |

## Pine

| Method | Path | Auth | Status | Notes |
| --- | --- | --- | --- | --- |
| POST | `/v1/pine/compile` | HMAC + admin | pending (bead `tradingview-la1`) | `{source, mode:"eval"|"full"|"light", inputs?, version?}`. |
| POST | `/v1/pine/run` | HMAC + admin | pending | Composes compile + study. |
| POST | `/v1/pine/save` | HMAC + admin | pending | `{mode:"new"|"new_draft"|"next"|"next_draft", id?, name?, source, allow_overwrite?, allow_create_new?}` |
| POST | `/v1/pine/publish` | HMAC + admin | pending | `{mode:"new"|"next", id?, source, extra, access}` |
| POST | `/v1/pine/delete` | HMAC + admin | pending | `{id}` |
| POST | `/v1/pine/rename` | HMAC + admin | pending | `{id, name, force?}` |
| POST | `/v1/pine/parse-title` | HMAC | pending | `{source}` |

## Strategy / backtest

| Method | Path | Auth | Status | Notes |
| --- | --- | --- | --- | --- |
| POST | `/v1/strategy/run` | HMAC + admin | pending (bead `tradingview-g6v`) | Properties + inputs + bars → `{report, trades, equity}`. |
| POST | `/v1/strategy/replay` | HMAC + admin | pending | SSE per-bar. |
| POST | `/v1/strategy/optimize` | HMAC + admin | pending | Parameter sweep wrapping `/v1/strategy/run`. |

## Alerts

| Method | Path | Auth | Status | Notes |
| --- | --- | --- | --- | --- |
| GET | `/v1/alerts` | HMAC + admin | pending (bead `tradingview-2lv`) | List alerts. |
| POST | `/v1/alerts/create-on-study` | HMAC + admin | pending | Indicator-driven. |
| POST | `/v1/alerts/create-pine` | HMAC + admin | pending | Two-phase `gen_alert` + `create_alert`. |
| POST | `/v1/alerts/create-price` | HMAC + admin | pending | Price condition shorthand. |
| POST | `/v1/alerts/modify` | HMAC + admin | pending | Wraps `modify_restart_alert`. |
| POST | `/v1/alerts/{stop,restart,delete,clone}` | HMAC + admin | pending | Plural arrays. |
| GET | `/v1/fires` | HMAC + admin | pending | Drains `/get_offline_fires` + `list_fires`. |
| POST | `/v1/fires/clear` | HMAC + admin | pending | |
| GET | `/v1/alerts/stream` | HMAC + admin | pending | Pushstream proxy (SSE or WSS). |

## Templates

| Method | Path | Auth | Status | Notes |
| --- | --- | --- | --- | --- |
| GET | `/v1/study-templates` | HMAC + admin | pending (bead `tradingview-6j1`) | `{custom, standard, fundamentals}` buckets. |
| POST | `/v1/study-templates` | HMAC + admin | pending | `{name, content, meta_info?}` |
| GET | `/v1/study-templates/{id}` | HMAC + admin | pending | `?standard=bool` |
| PUT | `/v1/study-templates/{id}` | HMAC + admin | pending | `{name, content, meta_info}` |
| DELETE | `/v1/study-templates/{id}` | HMAC + admin | pending | |
| POST | `/v1/study-templates/{id}/rename` | HMAC + admin | pending | `{name}` |
| PUT | `/v1/study-templates/{id}/favorite` | HMAC + admin | pending | `?standard=bool` |
| DELETE | `/v1/study-templates/{id}/favorite` | HMAC + admin | pending | |
| GET | `/v1/drawing-templates` | HMAC + admin | pending | `?tool=LineToolTrendLine` |
| GET | `/v1/drawing-templates/{tool}/{name}` | HMAC + admin | pending | |
| POST | `/v1/drawing-templates` | HMAC + admin | pending | `{tool, name, content}`; Worker FormData-encodes upstream. |
| DELETE | `/v1/drawing-templates/{tool}/{name}` | HMAC + admin | pending | |

## Personalisation / settings

| Method | Path | Auth | Status | Notes |
| --- | --- | --- | --- | --- |
| POST | `/v1/me` | HMAC + admin | live | Profile. |
| POST | `/v1/ideas` | HMAC | live | Public list; auth gives personalised. |
| POST | `/v1/minds` | HMAC | live | |
| POST | `/v1/login` | HMAC | live | Captcha-aware. |
| POST | `/v1/settings/save` | HMAC + admin | pending | `{delta:{key:value,…}}`; for indicator favorites, recents. |
| GET | `/v1/settings/load` | HMAC + admin | pending | |

## News / fundamentals / calendar

| Method | Path | Auth | Status |
| --- | --- | --- | --- |
| POST | `/v1/news` | HMAC | live |
| POST | `/v1/news/content` | HMAC | live |
| POST | `/v1/fundamentals` | HMAC | live |
| POST | `/v1/calendar/earnings` | HMAC | live |
| POST | `/v1/calendar/dividends` | HMAC | live |
| GET  | `/v1/news/symbol` | HMAC | live (news-mediator headlines) |
| GET  | `/v1/news/symbol-view` | HMAC | live (rendered symbol news view) |
| GET  | `/v1/news/category` | HMAC | live (category headlines) |
| GET  | `/v1/news/story` | HMAC | live (single story body) |
| GET  | `/v1/calendar/events` | HMAC | live (economic-calendar; Origin header injected) |
| POST | `/v1/calendar/ipos` | HMAC | live |
| POST | `/v1/calendar/splits` | HMAC | live |

## Charts-storage (P11)

| Method | Path | Auth | Status |
| --- | --- | --- | --- |
| POST | `/v1/charts/list` | HMAC + admin session | live |
| POST | `/v1/charts/token` | HMAC + admin session | live (RS512 JWT cached by (userId,layoutId); refresh on 401/403) |
| POST | `/v1/charts/layout` | HMAC + admin session | live |
| POST | `/v1/charts/layout/user` | HMAC + admin session | live (user-level sources) |
| POST | `/v1/charts/layout/save` | HMAC + admin session | live |
| POST | `/v1/charts/layout/delete` | HMAC + admin session | live |
| POST | `/v1/charts/layout/copy` | HMAC + admin session | lead (verify with smoke test) |
| POST | `/v1/charts/layout/move` | HMAC + admin session | lead (verify with smoke test) |

## Watchlists (P12)

| Method | Path | Auth | Status |
| --- | --- | --- | --- |
| GET  | `/v1/watchlists/list` | HMAC + admin session | live |
| GET  | `/v1/watchlists/get/{id}` | HMAC + admin session | live |
| POST | `/v1/watchlists/create` | HMAC + admin session | live |
| POST | `/v1/watchlists/delete/{id}` | HMAC + admin session | live |
| POST | `/v1/watchlists/append/{id}` | HMAC + admin session | live |
| POST | `/v1/watchlists/remove-symbols/{id}` | HMAC + admin session | live |
| POST | `/v1/watchlists/replace/{id}` | HMAC + admin session | live |
| POST | `/v1/watchlists/rename/{id}` | HMAC + admin session | live |
| POST | `/v1/watchlists/update-meta/{id}` | HMAC + admin session | live |
| POST | `/v1/watchlists/replace-symbol` | HMAC + admin session | live |
| GET  | `/v1/watchlists/active` | HMAC + admin session | live |
| POST | `/v1/watchlists/active/{id}` | HMAC + admin session | live |

## Pine CRUD (P13)

| Method | Path | Auth | Status |
| --- | --- | --- | --- |
| GET  | `/v1/pine/script-info` | HMAC | live (read-only allowed without session) |
| GET  | `/v1/pine/versions` | HMAC | live |
| GET  | `/v1/pine/versions-all` | HMAC | live |
| GET  | `/v1/pine/auth` | HMAC | live (session-gated read auth check) |
| GET  | `/v1/pine/list` | HMAC | live (filtered by category) |
| POST | `/v1/pine/save` | HMAC + admin session | live (modes: new, next, new_draft, next_draft) |
| POST | `/v1/pine/publish` | HMAC + admin session | live |
| POST | `/v1/pine/delete` | HMAC + admin session | live |
| POST | `/v1/pine/rename` | HMAC + admin session | live |
| POST | `/v1/pine/copy` | HMAC + admin session | live |
| POST | `/v1/pine/convert` | HMAC + admin session | live |
| POST | `/v1/pine/parse-title` | HMAC | live |
| GET  | `/v1/pine/translate-light` | HMAC | live |
| POST | `/v1/pine/gen-alert` | HMAC + admin session | live |

## Options (P14)

| Method | Path | Auth | Status |
| --- | --- | --- | --- |
| GET  | `/v1/options/iv/{symbol}` | HMAC | live |
| GET  | `/v1/options/volatility-chart/{symbol}` | HMAC | live |
| GET  | `/v1/options/expiries/{symbol}` | HMAC | live |
| GET  | `/v1/options/strikes/{symbol}` | HMAC | live |
| GET  | `/v1/options/chain/{symbol}` | HMAC | live |
| GET  | `/v1/options/greeks/{contractSymbol}` | HMAC | live |
| POST | `/v1/options/scan` | HMAC | live |
| GET  | `/v1/options/metainfo` | HMAC | live |

## Scanner v2 (P15)

| Method | Path | Auth | Status |
| --- | --- | --- | --- |
| POST | `/v1/scan2` | HMAC | live (filter2 boolean tree) |
| POST | `/v1/screener/metainfo` | HMAC | live |
| GET  | `/v1/screener/enum` | HMAC | live |
| GET  | `/v1/screener/columns` | HMAC | live |
| GET  | `/v1/screener/markets` | HMAC | live |
| GET  | `/v1/screener/symbol` | HMAC | live |

## Live streams (P18, StreamBridge DO)

| Method | Path | Auth | Status |
| --- | --- | --- | --- |
| GET  | `/v1/stream/alerts` | HMAC | live (SSE; pushstream private channel + alerts) |
| GET  | `/v1/stream/news` | HMAC | live (SSE; news-mediator) |
| GET  | `/v1/stream/notifications` | HMAC | live (SSE; user notifications) |
| POST | `/v1/stream/alerts/poll` | HMAC | live (1000-entry ring buffer; Last-Event-ID resume) |
| POST | `/v1/stream/news/poll` | HMAC | live |

## Drawing templates (P19)

| Method | Path | Auth | Status |
| --- | --- | --- | --- |
| POST | `/v1/line-tools/tools` | HMAC | live (drawing tool catalogue) |
| POST | `/v1/line-tools/templates/list` | HMAC + admin session | live |
| POST | `/v1/line-tools/templates/load` | HMAC + admin session | live |
| POST | `/v1/line-tools/templates/save` | HMAC + admin session | live |
| POST | `/v1/line-tools/templates/delete` | HMAC + admin session | live |

## www.tradingview.com REST (P20)

| Method | Path | Auth | Status |
| --- | --- | --- | --- |
| POST | `/v1/symbol/resolve` | HMAC | live |
| POST | `/v1/symbol/resolve-batch` | HMAC | live |
| POST | `/v1/study-templates/standard` | HMAC | live (built-in standard templates) |
| POST | `/v1/ideas/feed` | HMAC | live |
| POST | `/v1/social/tweet` | HMAC | live |
| POST | `/v1/chats/public` | HMAC | live |
| POST | `/v1/chats/dm` | HMAC + admin session | live |
| POST | `/v1/conversation-status` | HMAC | live |
| POST | `/v1/financial/fundamentals-config` | HMAC | live (KV-cached) |
| POST | `/v1/support/i18n` | HMAC | live (KV-cached) |
| POST | `/v1/brokers/trading-panel` | HMAC | live |
| POST | `/v1/user/profile` | HMAC + admin session | live (read or update) |

## TVSettings user prefs (P21)

| Method | Path | Auth | Status |
| --- | --- | --- | --- |
| POST | `/v1/user-prefs/favorites/indicators/list` | HMAC + admin session | live |
| POST | `/v1/user-prefs/favorites/indicators/add` | HMAC + admin session | live |
| POST | `/v1/user-prefs/favorites/indicators/remove` | HMAC + admin session | live |
| POST | `/v1/user-prefs/favorites/drawings/list` | HMAC + admin session | live |
| POST | `/v1/user-prefs/favorites/drawings/add` | HMAC + admin session | live |
| POST | `/v1/user-prefs/favorites/drawings/remove` | HMAC + admin session | live |
| POST | `/v1/user-prefs/recents/study-templates/list` | HMAC + admin session | live |
| POST | `/v1/user-prefs/recents/study-templates/add` | HMAC + admin session | live |
| POST | `/v1/user-prefs/saved-screens/list` | HMAC + admin session | live |
| POST | `/v1/user-prefs/saved-screens/save` | HMAC + admin session | live |
| POST | `/v1/user-prefs/saved-screens/delete` | HMAC + admin session | live |
| POST | `/v1/user-prefs/raw` | HMAC + admin session | live |

## WebSocket protocol depth (P17)

Stateful verbs forward to the existing chart-session DO instance keyed by `sessionToken`; the caller must have already opened the session via `/v1/chart-session/create`. Stateless verbs spin a transient WS session, run the probe, and close.

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| POST | `/v1/study/remove` | HMAC + admin session | Drop a study slot from the live chart session. |
| POST | `/v1/study/metadata` | HMAC + admin session | Transient probe; returns `studies_metadata` master schema. |
| POST | `/v1/study/get-first-bar-time` | HMAC + admin session | Probes earliest bar timestamp for `{symbol, timeframe}`. |
| POST | `/v1/study/data-quality` | HMAC + admin session | `{ quality: "low" \| "high" }`. |
| POST | `/v1/study/timezone` | HMAC + admin session | `{ tz: <IANA> }`. |
| POST | `/v1/quote/hibernate` | HMAC + admin session | Sends `quote_hibernate_all` against the chart session id. |
| POST | `/v1/series/modify` | HMAC + admin session | Re-parameterize series (`seriesId`, `sourceId`, `symbolId`, `timeframe`, `count`). |
| POST | `/v1/series/timeframe` | HMAC + admin session | `series_timeframe` (with optional `range:{from,to}`). |
| POST | `/v1/replay/start` | HMAC + admin session | Lazily creates a replay session, sends `replay_start`. |
| POST | `/v1/replay/stop` | HMAC + admin session | `replay_stop` against the active replay session. |
| POST | `/v1/replay/set-resolution` | HMAC + admin session | `replay_set_resolution`. |
| POST | `/v1/replay/get-depth` | HMAC + admin session | Sends `replay_get_depth`, awaits `replay_depth` event. |
| POST | `/v1/pointset/create` | HMAC + admin session | `create_pointset` with opaque trailing `args[]`. |
| POST | `/v1/pointset/modify` | HMAC + admin session | `modify_pointset`. |
| POST | `/v1/pointset/remove` | HMAC + admin session | `remove_pointset`. |

Inbound S→C events `study_loading`, `tickmark_update`, `index_update`, `clear_data`, `studies_metadata`, `protocol_error`, `protocol_switched`, `critical_error`, `replay_data_end`, `replay_depth`, `replay_resolutions`, `replay_instance_id`, `n` (notify), `m` (meta), and `get_first_bar_time` are decoded by `worker/src/ws-events.ts::decodeWSEvent` so DO consumers can pattern-match on the typed `WSEvent` union.

## Deferred

| Capability | Bead | Reason |
| --- | --- | --- |
| `modify_study` + study-on-study | `tradingview-xu3` | Requires DO-owned chart session (bead `tradingview-2v6`). |
| Stateful chart-session DO | `tradingview-2v6` | Multi-step iterate, replay-driven streaming. |
| Pine compile + run loop | `tradingview-la1` | Decomposes into P1 (`/v1/pine/compile`) + P2 (`/v1/pine/run`) above. |
| Strategy backtest | `tradingview-g6v` | Depends on P0 (`/v1/study` fix). |

## Error mapping

By route family the dominant `category` values to expect:

| Family | Common categories |
| --- | --- |
| Cache ops | `validation`, `internal` |
| Market data | `auth` (deep history without admin), `network`, `upstream`, `rate_limit` |
| Indicators / Pine | `auth`, `validation` (Pine compile errors include `details.errors[]`), `upstream` |
| Strategy | `auth`, `validation`, `upstream` (plan gating) |
| Alerts | `auth`, `validation`, `upstream` |
| Templates | `auth`, `validation`, `upstream` |

`retryable:true` only on `network`, `upstream`, `rate_limit`. Everything else is caller-fixable or operator-fixable.
