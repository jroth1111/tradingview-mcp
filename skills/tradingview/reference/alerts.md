# Alerts reference

Authority: `pricealerts.tradingview.com` for REST CRUD, `pushstream.tradingview.com` for live delivery, `pine-facade.tradingview.com` (`gen_alert`) for the first phase of Pine alert creation. `alerts.tradingview.com/alerts/health/` is legacy healthcheck only.

## Alert object schema (~30 keys, n=497 verified)

```json
{
  "alert_id": 123456,
  "name": "RSI overbought",
  "type": "price" | "indicator" | "strategy",
  "complexity": "primitive" | "complex",
  "kinds": "regular" | "watchlist",
  "symbol": "AAPL",
  "pro_symbol": "NASDAQ:AAPL",
  "resolution": "60",
  "active": true,
  "auto_deactivate": false,
  "create_time": 1700000000,
  "last_fire_time": 1701000000,
  "last_fire_bar_time": 1701000000,
  "last_stop_reason": null,
  "last_error": null,
  "expiration": 1800000000,
  "expiration_policy": { "policy": "fixed_date" | "open_ended", "time": 1800000000 },
  "condition": { /* legacy mirror of conditions[0] */ },
  "conditions": [
    {
      "type": "cross" | "cross_up" | "cross_down" | "greater" | "less" | "moving_up" | "moving_down" | "moving_up_percents" | "moving_down_percents" | "enter_channel" | "exit_channel" | "inside_channel" | "outside_channel" | "enter_shape" | "exit_shape" | "inside_shape" | "outside_shape" | "strategy" | "alert_cond" | "pine_alert" | "pine_alert_cond",
      "frequency": "only_once" | "once_per_minute" | "once_per_bar" | "once_per_bar_close" | "on_bar_close" | "on_first_fire",
      "series": [ /* see series item schema below */ ],
      "values": [ /* threshold(s), depends on type */ ]
    }
  ],
  "cross_interval": 0,
  "message": "Tick {{ticker}} crossed",
  "email": true,
  "sms_over_email": false,
  "mobile_push": true,
  "popup": true,
  "sound_file": "futuristic",
  "sound_duration": 5,
  "web_hook": { "url": "https://...", "auth_token": "..." },
  "presentation_data": { /* UI hints, can omit */ }
}
```

Send `condition` AND `conditions[0]` together; the legacy `condition` key still mirrors the first element. Multi-condition (`conditions.length > 1`) is gated by the `ALERTS_MULTICONDITIONS` feature flag — never observed enabled in capture; treat as bundle-only.

`expiration` (top-level) legacy-mirrors `expiration_policy.time`. Send both.

## Series item schema

```json
{
  "type": "barset" | "value" | "study" | "line" | "shape" | "financial" | "pine",
  "ref": { "symbol": "...", "resolution": "..." },
  "study": { "id": "STD;RSI", "version": 241, "inputs": {"in_0": 14}, "plot": "RSI" },
  "pine_id": "PUB;...",
  "pine_version": 12
}
```

`type:"study"` references an indicator output by `study.plot`. `type:"pine"` references a Pine v5+ alert (alertcondition or alert()). `type:"financial"` is a fundamental field (`STD;<FIELD>`).

## Frequencies

`only_once` — fires once and `auto_deactivate`s. `once_per_bar`, `once_per_bar_close`, `on_bar_close`, `once_per_minute` — rate-limited per the literal name. `on_first_fire` — fires when condition becomes true after being false. Pine `alert()` calls override this if the script specifies a frequency.

## Webhook templating

`message` field supports tokens that TradingView edge expands before delivery. Verified tokens (n=31):

```
{{ticker}}, {{exchange}}, {{interval}}, {{time}}, {{timenow}}
{{open}}, {{high}}, {{low}}, {{close}}, {{volume}}
{{strategy.order.action}}, {{strategy.order.contracts}}, {{strategy.order.price}}, {{strategy.order.id}}, {{strategy.order.comment}}
{{strategy.position_size}}, {{strategy.market_position}}, {{strategy.market_position_size}}
{{strategy.prev_market_position}}, {{strategy.prev_market_position_size}}
{{plot("plot_name")}}, {{plot_0}}, {{plot_1}}…{{plot_19}}
{{syminfo.basecurrency}}, {{syminfo.currency}}, {{syminfo.prefix}}, {{syminfo.root}}
{{syminfo.session}}, {{syminfo.timezone}}, {{syminfo.tickerid}}, {{syminfo.type}}
```

Webhook body is `text/plain` unless `message` parses as valid JSON, in which case `Content-Type: application/json`.

The Worker should NOT proxy outbound webhook delivery. TradingView edge calls `web_hook.url` directly. Interposing the Worker breaks IP allowlists, doubles latency, and re-introduces a single point of failure.

## REST CRUD (pricealerts.tradingview.com)

All POSTs take `{"payload": <obj>}` body. Worker appends query: `log_username=<u>&maintenance_unset_reason=&build_time=<ms>` for POSTs; `user_id=<id>` for the GET. Response envelope: `{s: "ok"|"error", id: <number>, r: <result>}`.

| Method | Path | Body | Use |
| --- | --- | --- | --- |
| GET | `/list_alerts?user_id=<id>` | — | All active + inactive alerts. |
| POST | `/get_alerts` | `{alerts: number[]}` | Hydrate by id. |
| POST | `/create_alert` | full Alert object | Create. |
| POST | `/modify_restart_alert` | Alert with `alert_id` | Modify AND restart. There is no separate `/modify_alert`. |
| POST | `/delete_alerts` | `{alerts: number[]}` | Delete (always plural). |
| POST | `/stop_alerts` | `{alerts: number[]}` | Pause. |
| POST | `/restart_alerts` | `{alerts: number[]}` | Resume. |
| POST | `/clone_alerts` | `{alerts: number[]}` | Duplicate. |
| POST | `/list_fires` | `{limit, alert_id?, before_time?}` | Fire history. |
| POST | `/delete_fires` | `{fires: number[]}` | |
| POST | `/delete_all_fires` | `{}` | |
| POST | `/delete_fires_by_filter` | `{alert_id?, before_time?}` | |
| POST | `/get_offline_fires` | `{limit}` (default 2000) | Pending fires user has not seen. |
| POST | `/get_offline_fire_controls` | `{}` | Pending control events (alerts_created/etc.). |
| POST | `/clear_offline_fires` | `{payloads: ClearPayload[]}` | Mark seen. |
| POST | `/clear_offline_fire_controls` | `{payloads}` | |
| GET | `/is_alive` | — | Cheapest health probe. |

Worker routes (see `endpoints.md`) wrap these with cookie injection from the admin store and unwrap the `{s, id, r}` envelope.

## Pushstream live delivery

`wss://pushstream.tradingview.com/message-pipe-ws/private_<TOKEN>` where `<TOKEN>` = `user.private_channel`. SSE fallback: `…/message-pipe-es`.

Frames: `{id, channel, text}` per `wire-formats.md`. Decoded events:

| Event | Payload (`p`) |
| --- | --- |
| `alerts_created` | `[<Alert>]` |
| `alerts_updated` | `[<Alert>]` |
| `alerts_deleted` | `[<alert_id>]` |
| `alert_fired` | `{alert_id, fire_id, time, bar_time, message, web_hook_status}` |
| `fires_deleted` | `[<fire_id>]` |

There is no per-topic subscribe verb. The user gets every event on their private channel. The Worker either proxies pushstream over SSE on `/v1/alerts/stream` or polls `/get_offline_fires` on demand.

On reconnect: drain `/get_offline_fires` + `/get_offline_fire_controls` first, then resume the WSS. Otherwise you miss fires that arrived during the disconnect window.

## Two-phase Pine alert creation

Pine v5 `alert()` calls require:

1. `POST /pine-facade/gen_alert/` body `{alert_info}` — TV generates an alert template from the Pine source.
2. `POST pricealerts/create_alert` body wrapping the gen_alert response with `condition.type = "pine_alert"`.

`alertcondition()` is simpler — surfaces as `"alert_cond$<id>"` operator on a single `/create_alert` call with `condition.type = "alert_cond"`.

The Worker route `POST /v1/alerts/create-pine` runs both phases server-side; callers send Pine source plus channels and frequency.

## Plan and rate gating

- TradingView caps total alerts per plan: Free 1, Pro 20, Pro+ 100, Premium 400.
- Tick alerts (`once_per_minute`) require Pro+.
- Webhook delivery requires Pro+.
- SMS over email requires Premium.

When `create_alert` returns `s:"error"` with `r:"limit_exceeded"` or `r:"plan_required"`, surface `category:"upstream"` with `details.upstreamReason`.

## Worker route mapping

| Worker route | Upstream | Notes |
| --- | --- | --- |
| `GET /v1/alerts` | `/list_alerts?user_id=<userId>` | userId comes from admin store. |
| `POST /v1/alerts/create-on-study` | `/create_alert` with `type:"indicator"`, `series` referencing study | |
| `POST /v1/alerts/create-pine` | `/gen_alert/` then `/create_alert` | |
| `POST /v1/alerts/create-price` | `/create_alert` with `type:"price"` | |
| `POST /v1/alerts/modify` | `/modify_restart_alert` | |
| `POST /v1/alerts/{stop,restart,delete,clone}` | `/{stop,restart,delete,clone}_alerts` | Plural arrays. |
| `GET /v1/fires` | drains `/get_offline_fires` then `list_fires` | |
| `POST /v1/fires/clear` | `/clear_offline_fires` + `/delete_fires_by_filter` | |
| `WSS /v1/alerts/stream` (or SSE) | pushstream proxy | `private_<TOKEN>` channel only. |
