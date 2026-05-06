# TradingView Direct Unauthenticated Probes - 2026-05-07

## Status

- Bead: `tradingview-lsn`
- Probe class: direct no-cookie HTTP probes against HAR-observed read surfaces
- Evidence timestamp: `2026-05-07`
- Working directory: `/Users/gwizz/CascadeProjects/Trading/tradingview`
- Sensitive source: `/Users/gwizz/Downloads/www.tradingview.com.har`

The HAR remains uncommitted. This artifact records sanitized direct probe outcomes only. No cookies, JWTs, authorization headers, or account identifiers were sent in these probes.

## Probe Contract

Source requirement: distinguish what can be achieved unauthenticated from what can be achieved authenticated, and continue discovery without downgrading capabilities on transient issues.

Positive probe: call safe read-only HAR-observed endpoints without cookies and record whether public data, login-required errors, shape errors, or network/runtime failures occur.

Negative probe: do not treat cookie-bearing HAR evidence alone as proof that an endpoint requires authentication. Only promote to `authenticated-required` when the no-cookie endpoint itself returns an auth/login-required signal.

Counterexample shown: several endpoints observed with cookies in the HAR still returned useful public data without cookies, including custom/default watchlist content, study templates, public script packages, Pine built-in lists, broker panel metadata, scanner symbol metadata, and fundamentals config.

## Direct Probe Results

| Surface | Method | Endpoint | No-cookie result | Classification |
| --- | --- | --- | --- | --- |
| Alerts list | `GET` | `pricealerts.tradingview.com/list_alerts` | HTTP 200 body `err.code=unauthorized` | authenticated-required |
| Alert offline fires | `POST` | `pricealerts.tradingview.com/get_offline_fires` | HTTP 200 body `err.code=unauthorized` | authenticated-required |
| Alert offline controls | `POST` | `pricealerts.tradingview.com/get_offline_fire_controls` | HTTP 200 body `err.code=unauthorized` | authenticated-required |
| Watchlists all | `GET` | `www.tradingview.com/api/v1/symbols_list/all/` | HTTP 403 `login_required` | authenticated-required |
| Watchlists colored | `GET` | `www.tradingview.com/api/v1/symbols_list/colored/` | HTTP 403 `login_required` | authenticated-required |
| Watchlists custom/default | `GET` | `www.tradingview.com/api/v1/symbols_list/custom/` | HTTP 200 default custom watchlist payload | unauthenticated-achievable |
| Study templates | `GET` | `www.tradingview.com/api/v1/study-templates` | HTTP 200 standard templates and empty custom list | unauthenticated-achievable |
| Script package store | `GET` | `www.tradingview.com/api/v1/script_packages/store/` | HTTP 200 public package list | unauthenticated-achievable |
| Personal script access | `GET` | `www.tradingview.com/pubscripts-get/personal-access/` | HTTP 403 `login_required` | authenticated-required |
| Pine built-in list | `GET` | `pine-facade.tradingview.com/pine-facade/list?filter=standard` | HTTP 200 built-in script list | unauthenticated-achievable |
| Pine fundamental list | `GET` | `pine-facade.tradingview.com/pine-facade/list?filter=fundamental` | HTTP 200 fundamental list | unauthenticated-achievable |
| Pine candlestick list | `GET` | `pine-facade.tradingview.com/pine-facade/list?filter=candlestick` | HTTP 200 candlestick list | unauthenticated-achievable |
| Pine saved list | `GET` | `pine-facade.tradingview.com/pine-facade/list?filter=saved` | HTTP 200 empty list | unauthenticated-achievable-empty |
| Pine auth capability | `GET` | `pine-facade.tradingview.com/pine-facade/is_auth_to_get/STD%3BSMA/last` | HTTP 200 `true` | unauthenticated-achievable |
| Broker trading panel | `GET` | `www.tradingview.com/api/v1/brokers/trading_panel` | HTTP 200 broker metadata list | unauthenticated-achievable |
| Fundamentals config | `GET` | `www.tradingview.com/financial/fundamentals_config_v2/` | HTTP 200 fundamentals metadata list | unauthenticated-achievable |
| Scanner symbol metadata | `GET` | `scanner.tradingview.com/symbol?symbol=NASDAQ:AAPL&fields=...` | HTTP 200 symbol metadata | unauthenticated-achievable |
| Support unread state | `GET` | `support-middleware.tradingview.com/api/v2/unreads/get` | HTTP 401 empty body | authenticated-required |
| My charts page | `GET` | `www.tradingview.com/my-charts/` | HTTP 200 unauthenticated HTML shell | unauthenticated-page-shell-only |
| Chart token | `GET` | `www.tradingview.com/chart-token/` | HTTP 400 missing `image_url` and `user_id` | shape-required; auth unknown |

## Classification Delta

Move from `authenticated-required-or-observed` to `unauthenticated-achievable`:

- `/api/v1/symbols_list/custom/` for default/public custom-list payload
- `/api/v1/study-templates` for standard templates
- `/api/v1/script_packages/store/` for public packages
- `pine-facade/list` for `standard`, `fundamental`, `candlestick`, and empty no-session `saved`
- `pine-facade/is_auth_to_get/STD%3BSMA/last`
- `/api/v1/brokers/trading_panel`
- `/financial/fundamentals_config_v2/`
- `scanner.tradingview.com/symbol`

Promote from `authenticated-observed` to `authenticated-required` for the probed no-cookie shapes:

- `pricealerts.tradingview.com/list_alerts`
- `pricealerts.tradingview.com/get_offline_fires`
- `pricealerts.tradingview.com/get_offline_fire_controls`
- `/api/v1/symbols_list/all/`
- `/api/v1/symbols_list/colored/`
- `/pubscripts-get/personal-access/`
- `support-middleware.tradingview.com/api/v2/unreads/get`

Keep as `auth-status-unknown`:

- `chart-token`, because the no-cookie probe failed on missing required fields before proving auth behavior.
- Mutating or stateful flows not directly probed here: alert create/edit/delete, watchlist/layout mutations, chart source storage with JWT, Pine eval/translate on user scripts, portfolio, paper trading, replay, and deep backtesting.

## Failure Classification

- Source/invocation: `pine-facade/list` without a `filter` query returned HTTP 400 `Argument filter is not given`; HAR query inspection showed `filter=fundamental|standard|candlestick|saved`, and the corrected no-cookie probes returned HTTP 200.
- Auth gate: alerts returned HTTP 200 with JSON `err.code=unauthorized`; watchlist-all/colored and personal script access returned HTTP 403 `login_required`; support unread returned HTTP 401.
- Shape gate: `chart-token` returned HTTP 400 because required fields were omitted. Do not classify auth from that result.
- No network/rate-limit/upstream failures occurred in this probe set.

## Remaining Runtime Gaps

1. Alert create/edit/delete and fire log details.
2. Layout save/load/update and chart source storage paths that require JWT-bearing query parameters in the HAR.
3. Watchlist mutations and authenticated user watchlist inventory beyond default no-session lists.
4. Options interactions beyond passive first load: underlying change, expiry, strategies, volatility chart, and chain details.
5. Portfolio and paper trading runtime calls.
6. Browser replay/deep-backtesting WebSocket frames and authenticated frame payload shapes.
7. Direct unauth/auth pair probes for Pine translate/eval with safe built-in scripts.

Follow-up: `docs/tradingview-pine-calendar-direct-probes-2026-05-07.md` now proves no-cookie Pine versions, translate, and minimal non-secret `eval_pine_ex`; `get_script_info` remains header/auth-gated for probed shapes.
