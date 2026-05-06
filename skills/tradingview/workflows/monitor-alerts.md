# Monitor alerts

List alerts, drain offline backlog, stream live fires.

1. **List**: `GET /v1/alerts` returns the user's full alert set (active + inactive). Filter client-side by `active`, `type`, `symbol`.
2. **Drain offline**: `GET /v1/fires` first — the Worker pulls `/get_offline_fires` (default limit 2000) plus `/get_offline_fire_controls` so you do not miss anything from before the connection.
3. **Live stream**: open `WSS /v1/alerts/stream` (or SSE if WSS unavailable). The Worker proxies pushstream `wss://pushstream.tradingview.com/message-pipe-ws/private_<TOKEN>` and forwards events:
   - `alerts_created` / `alerts_updated` / `alerts_deleted` — alert lifecycle.
   - `alert_fired` — `{alert_id, fire_id, time, bar_time, message, web_hook_status}`.
   - `fires_deleted` — `[fire_id]`.
4. **Modify** an alert: `POST /v1/alerts/modify` with the full alert object plus `alert_id`. The Worker calls `/modify_restart_alert` upstream (there is no `/modify_alert`).
5. **Pause / resume / delete / clone**: `POST /v1/alerts/{stop,restart,delete,clone}` with `{alerts: [<id>, …]}`. Always plural arrays.
6. **Clear fire history**: `POST /v1/fires/clear` with `{filter:{alert_id?, before_time?}}` or `{all:true}`.
7. Report: count of active alerts, last fires (with timestamps), any failed webhook delivery (`web_hook_status` ≠ 200).

Caveats:
- pushstream gives the user's entire private channel — there is no per-topic subscribe. You see every event, not just the alert you care about.
- On reconnect, drain offline first; otherwise you miss fires from the disconnect window.
- `alerts.tradingview.com/alerts/health/` is legacy healthcheck only; do not poll it for fires.

Reference: `reference/alerts.md`, `reference/wire-formats.md`.
