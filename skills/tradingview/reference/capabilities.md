# Capability matrix (full)

Two tiers gate every TradingView surface the Worker exposes. HMAC is universal; "auth" below means whether TradingView upstream needs a logged-in browser session (admin store).

## Public (HMAC only)

| Capability | Route | Notes |
| --- | --- | --- |
| Symbol search | `POST /v1/search` | Returns disambiguated `pro_symbol` + market metadata. |
| OHLC bars (recent) | `POST /v1/candles` | Up to ~5000 bars without auth. |
| Live snapshot quotes | `POST /v1/quotes` | Last/bid/ask/24h. |
| Multi-symbol scan | `POST /v1/scan` | Backed by `scanner.tradingview.com`. |
| TA snapshot | `POST /v1/ta` | Synthesised summary. |
| TA scoring summary | `POST /v1/ta/summary` | Buy/sell/neutral counts. |
| Built-in indicator catalog | `GET /v1/indicators/builtin` | `STD;`/candlestick/fundamental aggregate. |
| Pubscripts library | `GET /v1/pubscripts/library` | Public scripts browse with `sort`, `type`, `is_paid`. |
| Pubscripts editors picks | `GET /v1/pubscripts/editors-picks` | |
| Pubscripts batch hydrate | `POST /v1/pubscripts/batch` | Resolve `scriptIdPart[]` to full metainfo. |
| Pubscripts suggest | `GET /v1/pubscripts/suggest` | Typeahead. |
| Indicator metadata | `POST /v1/indicators/meta` | Read `metaInfo.inputs[]` typed. |
| Typed indicator inputs | `GET /v1/indicators/inputs/{id}` | Pre-derived from metadata. |
| Indicator combined search | `POST /v1/indicators/search` | Built-ins + public scripts merged. |
| News list | `POST /v1/news` | |
| News content | `POST /v1/news/content` | |
| Fundamentals | `POST /v1/fundamentals` | |
| Earnings / dividends calendar | `POST /v1/calendar/earnings`, `POST /v1/calendar/dividends` | |
| News-mediator headlines | `GET /v1/news/symbol`, `GET /v1/news/symbol-view`, `GET /v1/news/category`, `GET /v1/news/story` | news-mediator host (P16). |
| Economic calendar / IPO / splits | `GET /v1/calendar/events`, `POST /v1/calendar/ipos`, `POST /v1/calendar/splits` | Origin header injected upstream (P16). |
| Symbol resolve (www) | `POST /v1/symbol/resolve`, `POST /v1/symbol/resolve-batch` | www.tradingview.com REST surface (P20). |
| Standard study templates | `POST /v1/study-templates/standard` | Built-in templates (P20). |
| Ideas feed | `POST /v1/ideas/feed` | (P20) |
| Public chats / DM lists | `POST /v1/chats/public`, `POST /v1/chats/dm`, `POST /v1/conversation-status` | DM list requires admin session (P20). |
| Tweet / fundamentals-config / support i18n / brokers | `POST /v1/social/tweet`, `POST /v1/financial/fundamentals-config`, `POST /v1/support/i18n`, `POST /v1/brokers/trading-panel` | KV-cached read surfaces (P20). |
| Scanner v2 | `POST /v1/scan2`, `POST /v1/screener/metainfo`, `GET /v1/screener/{enum,columns,markets,symbol}` | filter2 boolean tree (P15). |
| Options snapshot | `GET /v1/options/iv/{sym}`, `volatility-chart/{sym}`, `expiries/{sym}`, `strikes/{sym}`, `chain/{sym}`, `greeks/{cs}`, `POST /v1/options/scan`, `GET /v1/options/metainfo` | (P14) |
| Pine read-only | `GET /v1/pine/{script-info,versions,versions-all,auth,list,translate-light}` | Some require admin session for owned drafts (P13). |
| Pine parse-title | `POST /v1/pine/parse-title` | (P13) |
| Drawing tool catalogue | `POST /v1/line-tools/tools` | (P19) |
| Movers | `POST /v1/movers` | Gainers/losers per market. |
| Sector / industry movers | `POST /v1/markets/sector-movers`, `industry-movers`, `overview` | |
| Symbol resolve | `POST /v1/resolve` | Same as search but single ticker. |
| Markets meta | `GET /v1/meta/markets`, `news`, `fundamentals`, `timeframes` | Static reference data. |
| Stream bootstrap | `POST /v1/stream/bootstrap` | Token plus quote-session metadata. |
| Health | `GET /health` | Always public. |

## Authenticated (HMAC + admin session)

| Capability | Route | Notes |
| --- | --- | --- |
| Run indicator (built-in / public / private) | `POST /v1/study` | Returns plot output keyed by series timestamp. |
| Pine compile | `POST /v1/pine/compile` | Modes `eval` / `full` / `light`. |
| Pine run | `POST /v1/pine/run` | Compose compile + study. Accepts source or pineId. |
| Pine save (draft / saved / next) | `POST /v1/pine/save` | Mode = `new`, `new_draft`, `next`, `next_draft`. |
| Pine publish | `POST /v1/pine/publish` | Mode = `new`, `next`, with access scope. |
| Pine delete / rename | `POST /v1/pine/delete`, `POST /v1/pine/rename` | |
| Strategy backtest | `POST /v1/strategy/run` | Properties + inputs + bars; returns report + trades + equity. |
| Strategy replay (per-bar) | `POST /v1/strategy/replay` | SSE stream reusing `du` frames. |
| Closed-source backtest | `POST /v1/strategy/run` with `pineId` reference | Requires `is_auth_to_get` truthy. |
| Private indicator list | `POST /v1/indicators/private` | |
| Indicator favorites / recents | `POST /v1/settings/save`, `GET /v1/settings/load` | TVSettings keyed; not a dedicated endpoint upstream. |
| Deep history | `POST /v1/backfill` | Multi-window pagination. |
| Replay session | `POST /v1/replay` | |
| Auth token mint | `POST /v1/auth-token` | Internal; refreshes upstream auth_token. |
| Login / handshake | `POST /v1/login` | Captcha + 2FA aware. |
| User profile | `POST /v1/me` | |
| Ideas / Minds | `POST /v1/ideas`, `POST /v1/minds` | Public reads usable too; auth needed for personalised feeds. |
| Alerts list | `GET /v1/alerts` | |
| Alerts CRUD | `POST /v1/alerts/create-on-study`, `create-pine`, `create-price`, `modify`, `stop`, `restart`, `clone`, `delete` | |
| Alert fires | `GET /v1/fires`, `POST /v1/fires/clear` | |
| Live alert delivery | `WSS /v1/alerts/stream` | Pushstream proxy. |
| Study templates | `GET /v1/study-templates`, `POST/PUT/DELETE /v1/study-templates/{id}`, `/rename`, `/favorite` | |
| Drawing templates | `GET /v1/drawing-templates?tool=`, `POST /v1/drawing-templates`, `DELETE /v1/drawing-templates/{tool}/{name}` | |
| Drawing tool templates (line-tools, P19) | `POST /v1/line-tools/templates/{list,load,save,delete}` | TVSettings-stored per-tool templates. |
| Cache invalidate | `POST /cache/{symbol}/{tf}/invalidate` | Operations only. |
| Charts-storage (P11) | `POST /v1/charts/list`, `/charts/token`, `/charts/layout`, `/charts/layout/user`, `/charts/layout/save`, `/charts/layout/delete`, `/charts/layout/copy` (lead), `/charts/layout/move` (lead) | RS512 chart-token JWT minted Worker-side (cached by `(userId,layoutId)`); refresh on 401/403. |
| Watchlists (P12) | `GET /v1/watchlists/list`, `/watchlists/get/{id}`, `/watchlists/active`; `POST /v1/watchlists/{create,delete/{id},append/{id},remove-symbols/{id},replace/{id},rename/{id},update-meta/{id},replace-symbol,active/{id}}` | Active-watchlist pointer is separate; symbol replace operates across all lists. |
| Pine CRUD writes (P13) | `POST /v1/pine/{save,publish,delete,rename,copy,convert,gen-alert}` | Modes for save: `new`/`next`/`new_draft`/`next_draft`. |
| Live streams (P18, StreamBridge DO) | `GET /v1/stream/alerts`, `/stream/news`, `/stream/notifications`; `POST /v1/stream/alerts/poll`, `/stream/news/poll` | SSE bridge backed by 1000-entry ring buffer; `Last-Event-ID` resume; pushstream private channel + alerts channel. |
| User/profile (www, P20) | `POST /v1/user/profile` (read or update) | Session-gated. |
| TVSettings prefs (P21) | `POST /v1/user-prefs/favorites/{indicators,drawings}/{list,add,remove}`, `/user-prefs/recents/study-templates/{list,add}`, `/user-prefs/saved-screens/{list,save,delete}`, `/user-prefs/raw` | Semantic layer over TVSettings; `/raw` returns the full prefs blob. |

## Plan gating

TradingView caps shared by every authenticated route, regardless of Worker:

- ~5,000 bars per series for Free/Pro; 10–20k for Pro+; 40k+ for Premium.
- Realtime data on most exchanges requires a TradingView add-on; without it the Worker returns delayed data and the response includes the delay window.
- Some studies / strategies are gated behind specific plans; expect `study_error` with `category:"upstream"` and `upstreamError.message:"plan_required"`.
- Pine compile errors come back through the Worker as `category:"validation"` with `upstreamError.errors[]` populated.

## Known absences

These verbs do not exist on the public TradingView surface and the Worker should not pretend to expose them:

- No like / rate / comment endpoints on pubscripts.
- No by-author or by-tag filter on pubscripts library (only `type` ∈ {1=indicator, 2=strategy, 3=library, all}).
- No outbound webhook proxy. TradingView edge delivers `web_hook.url` directly; do not interpose.
- No `apply_template` envelope. Study templates apply client-side via `model.applyStudyTemplate`; the Worker re-runs the underlying `create_study` calls.
- No per-topic subscribe on pushstream. Users get their entire private channel.
- No dedicated `report_data` frame for strategies. The report is computed client-side from `du` plot output arrays.

If a user asks for one of these, surface the absence and offer the closest supported approximation.
