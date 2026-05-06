# Set up alert

Create a price, indicator, or Pine alert with channels and frequency.

1. Decide the alert type:
   - **Price** — value vs threshold (`>`, `<`, cross). Lightest setup.
   - **Indicator** — based on a study's plot output. Needs `studyId`, `inputs`, `plot`.
   - **Pine** — calls `alert()` or `alertcondition()` from a Pine script. Two-phase upstream.
2. Resolve the symbol with `POST /v1/search` if needed.
3. **Price alert**:
   ```json
   POST /v1/alerts/create-price
   {
     "symbol":"NASDAQ:AAPL", "resolution":"60",
     "condition":{"type":"greater","value":200,"frequency":"once_per_bar_close"},
     "name":"AAPL>200", "message":"Tick {{ticker}} crossed 200",
     "channels":{"email":true,"mobile_push":true,"popup":false},
     "expiration_policy":{"policy":"open_ended"}
   }
   ```
4. **Indicator alert**:
   ```json
   POST /v1/alerts/create-on-study
   {
     "symbol":"NASDAQ:AAPL","resolution":"60",
     "study":{"id":"STD;RSI","inputs":{"in_0":14},"plot":"RSI"},
     "condition":{"type":"cross_down","value":30,"frequency":"once_per_bar_close"},
     "name":"RSI<30","message":"RSI oversold"
   }
   ```
5. **Pine alert** (`alert()` calls):
   ```json
   POST /v1/alerts/create-pine
   {
     "symbol":"NASDAQ:AAPL","resolution":"60",
     "pineId":"PUB;...","pineVersion":12,
     "alert_info":{"name":"...","message":"...","frequency":"once_per_bar_close"}
   }
   ```
   The Worker runs `gen_alert` then `create_alert` server-side.
6. Optional channels:
   - `web_hook: { url, auth_token? }` — TV edge calls the URL directly. Do NOT proxy via the Worker.
   - `sms_over_email: true` — Premium plan only.
   - `sound_file`, `sound_duration` — popup audio.
7. Report `alert_id` plus the resolved `expiration` (TV may clamp). On error, surface `category:"upstream"` with `upstreamError`.

Frequencies (pick one): `only_once`, `once_per_minute` (Pro+), `once_per_bar`, `once_per_bar_close`, `on_bar_close`, `on_first_fire`.

Webhook templating tokens (subset): `{{ticker}}`, `{{exchange}}`, `{{interval}}`, `{{open|high|low|close|volume}}`, `{{time}}`, `{{strategy.order.action}}`, `{{plot("name")}}`, `{{syminfo.X}}`. Webhook body is `text/plain` unless `message` parses as JSON.

Caveats:
- Plan caps total active alerts (Free 1, Pro 20, Pro+ 100, Premium 400). On `s:"error", r:"limit_exceeded"`, surface and stop.
- Webhook URL is called by TV edge from a fixed IP range — surface that to the user if they need to allowlist.

Reference: `reference/alerts.md`.
