# TradingView HAR Runtime Capture - 2026-05-06

## Status

- Bead: `tradingview-lsn`
- Source HAR: `/Users/gwizz/Downloads/www.tradingview.com.har`
- HAR size: 6.4 MB
- HAR start time: `2026-05-06T20:36:54.900Z`
- Entries: 121
- Methods: 92 `GET`, 29 `POST`
- Statuses: 119 `200`, 2 `304`
- Cookie-bearing requests: 95
- Authorization header requests: 0
- Response `Set-Cookie` entries: 1
- Redacted schema sketches: `docs/tradingview-har-schema-sketches-2026-05-06.md`
- Clean-browser unauthenticated runtime follow-up: `docs/tradingview-unauth-browser-runtime-2026-05-07.md`

The HAR is sensitive and was not committed. This artifact records only sanitized host/path/method/status/auth-evidence summaries.

## Auth Distinction

The rediscovery inventory should use three buckets:

- `unauthenticated-achievable`: request observed with no cookie/JWT evidence, or previously reproduced with direct unauthenticated `curl`/WebSocket probes.
- `authenticated-required-or-observed`: request observed with cookies, JWT query parameters, account endpoints, or user-specific resource paths.
- `auth-status-unknown`: static bundle or page evidence exists, but no HAR/runtime request has proven whether auth is required.

This HAR clearly contains authenticated runtime activity: it includes `/accounts/signin/`, 95 cookie-bearing requests, chart-storage requests with `jwt` query parameters, alerts list/offline-fire calls, user watchlists, chats, study templates, Pine facade calls, and `my-charts`.

## Unauthenticated-Achievable In HAR

| Method | Host | Path | Status | Notes |
| --- | --- | --- | --- | --- |
| `GET` | `data.tradingview.com` | `/ping` | 200 | WebSocket host health/ping |
| `GET` | `prodata.tradingview.com` | `/ping` | 200 | Pro WebSocket host health/ping |
| `GET` | `economic-calendar.tradingview.com` | `/events` | 200 | Query keys: `from`, `to`, `countries` |
| `GET` | `news-mediator.tradingview.com` | `/public/news-flow/v2/news` | 200 | Public news flow with filters/client/prostatus/streaming params |
| `GET` | `news-mediator.tradingview.com` | `/public/view/v1/symbol` | 200 | Public symbol news view |
| `GET` | `symbol-search.tradingview.com` | `/symbol_search/v3/` | 200 | Query keys include text, exchange, language, domain, sort/promo controls |
| `GET` | `s3.tradingview.com` | `/conversions_en.json` | 200 | Static conversion data |
| `GET` | `scanner-backend.tradingview.com` | `/enum/ordered` | 200 | Ordered enum metadata |
| `POST` | `telemetry.tradingview.com` | `/news/report`, `/calendars/report`, `/free/report`, `/pine/report`, etc. | 200 | Telemetry only; not a product data source |

These are candidates for unauthenticated Worker support or validation probes.

## Authenticated-Required Or Authenticated-Observed

| Method | Host | Path | Status | Auth evidence | Surface |
| --- | --- | --- | --- | --- | --- |
| `POST` | `www.tradingview.com` | `/accounts/signin/` | 200 | cookie | login/session |
| `GET` | `charts-storage.tradingview.com` | `/charts-storage/get/user/sources` | 200 | `jwt` query | user chart source storage |
| `GET` | `charts-storage.tradingview.com` | `/charts-storage/get/layout/.../sources` | 200 | `jwt` query | layout-specific sources |
| `GET` | `pricealerts.tradingview.com` | `/list_alerts` | 200 | cookie | alerts inventory |
| `POST` | `pricealerts.tradingview.com` | `/get_offline_fires` | 200 | cookie | offline alert fires |
| `POST` | `pricealerts.tradingview.com` | `/get_offline_fire_controls` | 200 | cookie | alert fire controls |
| `GET` | `www.tradingview.com` | `/api/v1/symbols_list/all/` | 200 | cookie | watchlists |
| `GET` | `www.tradingview.com` | `/api/v1/symbols_list/colored/` | 200 | cookie | colored watchlist lists |
| `GET` | `www.tradingview.com` | `/api/v1/symbols_list/custom/` | 200 | cookie | custom watchlists |
| `GET` | `www.tradingview.com` | `/my-charts/` | 200 | cookie | saved charts |
| `GET` | `www.tradingview.com` | `/chart-token/` | 200 | cookie | chart/share image token |
| `GET` | `www.tradingview.com` | `/api/v1/study-templates` | 200 | cookie | study templates |
| `GET` | `www.tradingview.com` | `/api/v1/script_packages/store/` | 200 | cookie | script package store |
| `GET` | `www.tradingview.com` | `/pubscripts-get/personal-access/` | 200 | cookie | personal script access |
| `POST` | `www.tradingview.com` | `/pubscripts-get/` | 200 | cookie | public scripts search/data |
| `GET` | `pine-facade.tradingview.com` | `/pine-facade/list` | 200 | cookie | Pine listing |
| `POST` | `pine-facade.tradingview.com` | `/pine-facade/eval_pine_ex/` | 200 | cookie | Pine evaluation/compile-style surface |
| `GET` | `pine-facade.tradingview.com` | `/pine-facade/translate/...` | 200 | cookie | Pine translate |
| `GET` | `pine-facade.tradingview.com` | `/pine-facade/get_script_info/` | 200 | cookie | script metadata |
| `GET` | `www.tradingview.com` | `/chats/get/`, `/chats/public/get/`, `/conversation-status/` | 200 | cookie | chats/community |
| `GET` | `support-middleware.tradingview.com` | `/api/v2/unreads/get` | 200 | cookie | support/chat notification state |
| `GET` | `www.tradingview.com` | `/api/v1/brokers/trading_panel` | 200 | cookie | broker/trading panel metadata |
| `POST` | `scanner.tradingview.com` | `/america/scan`, `/australia/scan`, `/bond/scan`, `/global/scan` | 200 | cookie | scanner requests in authenticated session |
| `GET` | `scanner.tradingview.com` | `/symbol` | 200 | cookie | scanner symbol metadata |
| `GET` | `www.tradingview.com` | `/financial/fundamentals_config_v2/` | 200 | cookie | fundamentals config |

Authentication evidence here means the captured request carried cookies or JWTs. It does not prove the endpoint cannot work unauthenticated with another shape; it proves the observed runtime path was authenticated.

## Previously Static Leads Now Runtime-Proven

The HAR upgrades these from static bundle/page leads to runtime-proven endpoints:

- Economic calendar: `GET economic-calendar.tradingview.com/events`
- News flow: `GET news-mediator.tradingview.com/public/news-flow/v2/news`
- Symbol search v3: `GET symbol-search.tradingview.com/symbol_search/v3/`
- Alerts: `GET pricealerts.tradingview.com/list_alerts`, `POST /get_offline_fires`, `POST /get_offline_fire_controls`
- Chart storage: `GET charts-storage.tradingview.com/charts-storage/get/user/sources`, `GET /charts-storage/get/layout/.../sources`
- Pine facade: list, versions, script info, translate, and `eval_pine_ex`
- Watchlists: `symbols_list/all`, `symbols_list/colored`, `symbols_list/custom`
- Study templates and script package store
- Broker trading panel metadata

The follow-up clean-browser pass additionally proves unauthenticated runtime access for options scanner bootstrap, stock heatmap scanner feed, economic calendar events, dividend/earnings scanner feeds, and options symbol search. Use that artifact when deciding whether Worker support can start from an unauthenticated mode before adding authenticated enrichment.

## Worker Coverage Delta

| Runtime surface | Current Worker support | Gap |
| --- | --- | --- |
| Economic calendar `/events` | dividend/earnings only | add economic calendar event endpoint with from/to/countries |
| News mediator flow | partial news endpoints | add mediator news-flow and symbol-view variants if needed |
| Symbol search v3 | partial search | compare current search route against v3 query/response shape |
| Alerts list/offline fires | absent | authenticated alerts read surfaces |
| Chart storage/user/layout sources | absent | authenticated chart layout/source retrieval |
| Watchlists | absent | authenticated watchlist list/read surfaces |
| Pine facade eval/list/translate/script info | partial private indicator/study surfaces | Pine facade runtime endpoints |
| Study templates | absent | authenticated study-template list |
| Broker trading panel metadata | absent | read-only broker panel metadata |
| Chats/support unread | absent | likely out of Worker market-data scope unless explicitly requested |

## Next HAR/Runtime Work

1. Capture or interact with alert create/edit/delete, not only alert list/offline-fire reads.
2. Capture layout save/update and watchlist mutate paths separately from read/list paths.
3. Capture options page XHR; this HAR did not include runtime options chain/strategy calls.
4. Capture portfolio and paper trading runtime paths; this HAR only proves broker/trading panel and paper feature evidence, not portfolio/paper service calls.
5. Capture replay/deep-backtesting browser flows and WebSocket frames.
6. For every endpoint promoted to Worker support, rerun one unauthenticated and one authenticated probe to classify whether auth is required or merely present in the HAR.

## Acceptance Holes

Negative-probe hole: the HAR proves observed runtime surfaces, but does not prove the user interacted with every target UI surface from `tradingview-lsn`; options, portfolio, paper trading, replay, deep backtesting, and mutating alert/watchlist/layout flows remain incomplete.

Positive-probe hole: request bodies and response bodies were not committed because the HAR is sensitive. Schema-grade implementation requires a redacted fixture or fresh targeted capture for each endpoint.
