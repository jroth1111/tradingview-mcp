# TradingView Worker Authentication

## HMAC

Every upstream-reaching Worker request must include:

- `Authorization: HMAC <clientId>:<signature>`
- `X-Timestamp: <milliseconds since epoch>`

Canonical string:

```text
METHOD
/path?query
sha256(body)
timestamp
```

The Worker fails closed when `HMAC_SECRET` or `HMAC_CLIENT_ID` is missing.

## TradingView Session

Store TradingView browser credentials through the Worker admin endpoint:

1. Capture a fresh `sessionid` and optional `sessionid_sign` from the browser.
2. Send an HMAC-signed `POST /admin/session` request:

```json
{
  "sessionId": "fresh-sessionid-cookie",
  "sessionSign": "optional-sessionid_sign-cookie"
}
```

Do not persist real credentials in `tradingview-auth.json`, `admin-tokens.json`, `.hmac-secrets.json`, `hmac-client.json`, or `auth.json`.

## Session Precedence

The stored Worker session is authoritative. If a request body or query includes `sessionId`, the Worker still prefers the stored session when one exists and is not blocked.
