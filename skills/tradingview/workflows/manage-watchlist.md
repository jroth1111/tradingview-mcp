# Manage watchlists

Create, edit, and switch between TradingView symbol lists (`symbols_list`).
Two list flavours exist:

- **`custom`** — user lists with full CRUD: create / rename / describe /
  add / remove / replace / delete / set active.
- **`colored`** — seven fixed slots (red, orange, green, purple, blue, cyan,
  pink). `name` is always `""`, `id` is `null` for empty slots, `color` is
  set. Only the `replace_symbol` op is supported on colored lists.

All routes are `HMAC + admin` and the Worker injects the stored TradingView
cookie. Callers never pass a `sessionId`.

1. **List** all watchlists:
   ```json
   GET /v1/watchlists/list?type=all
   ```
   `type` is `all`, `custom`, or `colored`. Returns `Watchlist[]`.

2. **Inspect one** custom list:
   ```json
   GET /v1/watchlists/get/{id}
   ```
   Returns the single `Watchlist` object including `symbols`,
   `description`, `created`, `modified`.

3. **Create** a new custom list:
   ```json
   POST /v1/watchlists/create
   { "name": "Swing trades", "symbols": ["NASDAQ:AAPL", "NASDAQ:MSFT"] }
   ```
   `symbols` may be empty. Response is the freshly-stored `Watchlist`.

4. **Add** symbols to an existing list:
   ```json
   POST /v1/watchlists/append/{id}
   ["NASDAQ:NVDA", "NASDAQ:TSLA"]
   ```
   The body is a JSON **array of strings**, not an object.

5. **Remove** symbols (same plural-array body):
   ```json
   POST /v1/watchlists/remove-symbols/{id}
   ["NASDAQ:TSLA"]
   ```

6. **Replace the entire symbol set**:
   ```json
   POST /v1/watchlists/replace/{id}
   ["NASDAQ:NVDA", "NASDAQ:META"]
   ```
   Upstream calls this with `?unsafe=true`; the Worker forwards the flag.

7. **Rename** / **describe** the list:
   ```json
   POST /v1/watchlists/rename/{id}        { "name": "Renamed" }
   POST /v1/watchlists/update-meta/{id}   { "description": "..." }
   ```

8. **Swap a single symbol** (works on custom **and** colored lists):
   ```json
   POST /v1/watchlists/replace-symbol
   { "type": "custom", "id": 42, "old": "NASDAQ:AAPL", "new": "NASDAQ:NVDA" }
   ```
   For colored slots, set `type:"colored"` and pass the slot id from
   `GET /v1/watchlists/list?type=colored`. Slots whose `id` is `null` are
   empty — pick a non-null slot first.

9. **Delete** a custom list:
   ```json
   POST /v1/watchlists/delete/{id}
   ```
   No body. Returns an empty object on success.

10. **Active list** management:
    ```json
    GET  /v1/watchlists/active            // currently active Watchlist
    POST /v1/watchlists/active/{id}       // switch to {id}
    ```
    Active state is server-authoritative; persists across UI sessions.

## Edit recipe (in order)

To rebuild a watchlist atomically, prefer the diff route:

1. `GET /v1/watchlists/get/{id}` — current symbols.
2. `POST /v1/watchlists/append/{id}` — added tickers only.
3. `POST /v1/watchlists/remove-symbols/{id}` — removed tickers only.

If callers are not tracking the diff, use
`POST /v1/watchlists/replace/{id}` with the full new set — it is
idempotent and cheaper to reason about, but may briefly show an empty
list to other open clients between the upstream replace and the next
poll.

## Caveats

- Colored lists cannot be created / deleted / renamed; they are seven
  fixed slots that always exist.
- Symbol strings are exchange-prefixed (`NASDAQ:AAPL`,
  `BINANCE:BTCUSDT`). Use `POST /v1/search` to disambiguate before
  appending if the user only gave a ticker.
- `description` is a free-form string; long values may be truncated by
  the TradingView UI but the API itself does not cap length.
- TradingView occasionally pins a `csrftoken` cookie on the session;
  the Worker forwards it as `X-CSRFToken` automatically when present —
  callers do nothing.

Reference: `recon/agents/07-watchlists.md`, `worker/src/watchlists.ts`.
