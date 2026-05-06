# TradingView HAR Schema Sketches - 2026-05-06

## Status

- Source HAR: `/Users/gwizz/Downloads/www.tradingview.com.har`
- Parent artifact: `docs/tradingview-har-runtime-capture-2026-05-06.md`
- Evidence type: redacted request/response shape extraction
- Sensitive data handling: no cookie, JWT, username, user id, script source, alert value, symbol-list content, or full response body is committed here

These sketches are for discovery and implementation planning only. Each endpoint still needs a targeted redacted fixture before being treated as fully specified.

## Scanner

Observed authenticated scanner requests:

- `POST scanner.tradingview.com/america/scan`
- `POST scanner.tradingview.com/global/scan`
- `POST scanner.tradingview.com/australia/scan`
- `POST scanner.tradingview.com/bond/scan`
- `GET scanner.tradingview.com/symbol`

Common scan request shape:

```json
{
  "columns": ["string"],
  "filter": [{ "left": "string", "operation": "string", "right": "array-or-string" }],
  "range": ["number"],
  "sort": { "sortBy": "string", "sortOrder": "string" },
  "options": { "lang": "string" },
  "preset": "string",
  "ignore_unknown_fields": "boolean"
}
```

Bond scan adds:

```json
{
  "index_filters": [{ "name": "string", "values": ["string"] }]
}
```

Bond scan response shape:

```json
{
  "totalCount": "number",
  "data": [{ "s": "string", "d": ["number"] }],
  "params": {
    "bond": {
      "symbols": { "query": "object" },
      "filter": ["object"],
      "index_filters": ["object"],
      "sort": { "sortBy": "string", "sortOrder": "string", "nullsFirst": "boolean" }
    }
  }
}
```

`GET /symbol` response includes scanner field keys such as `Perf.*`, `Recommend.All`, volume fields, country/market/sector fields, ETF/nav fields, and options-greek placeholders.

## Alerts

Observed authenticated alert requests:

- `GET pricealerts.tradingview.com/list_alerts`
- `POST pricealerts.tradingview.com/get_offline_fires`
- `POST pricealerts.tradingview.com/get_offline_fire_controls`

Offline fires request:

```json
{
  "payload": { "limit": "number" }
}
```

`list_alerts` response shape:

```json
{
  "s": "string",
  "id": "string",
  "r": [{
    "symbol": "string",
    "resolution": "string",
    "condition": {
      "type": "string",
      "frequency": "string",
      "series": ["object"],
      "cross_interval": "boolean",
      "resolution": "string"
    },
    "conditions": ["object"],
    "expiration": "string",
    "expiration_policy": { "time": "string", "policy": "string" },
    "email": "boolean",
    "mobile_push": "boolean",
    "message": "string",
    "alert_id": "number",
    "active": "boolean",
    "create_time": "string",
    "last_fire_time": "string",
    "last_stop_reason": "string",
    "complexity": "string",
    "presentation_data": { "main_series": "object" },
    "kinds": ["string"],
    "pro_symbol": "string"
  }]
}
```

Mutation endpoints were not captured.

## Watchlists

Observed authenticated watchlist reads:

- `GET www.tradingview.com/api/v1/symbols_list/all/`
- `GET www.tradingview.com/api/v1/symbols_list/colored/`
- `GET www.tradingview.com/api/v1/symbols_list/custom/`

Common response item:

```json
{
  "id": "number",
  "type": "string",
  "name": "string",
  "symbols": ["string"],
  "active": "boolean",
  "shared": "boolean",
  "color": "string-or-null",
  "description": "string-or-null",
  "created": "string",
  "modified": "string"
}
```

Mutation endpoints were not captured.

## Chart Storage

Observed authenticated chart storage reads:

- `GET charts-storage.tradingview.com/charts-storage/get/user/sources`
- `GET charts-storage.tradingview.com/charts-storage/get/layout/.../sources`

Query keys include `layout_id`, `chart_id`, `symbol`, `includeOwnerSource`, `excludeOwnerSource`, and `brokerName`; observed requests carried a `jwt` query parameter.

Response shape:

```json
{
  "success": "boolean",
  "payload": "object"
}
```

The captured payload objects were empty in the sampled entries, so layout/source schema is still unproven.

## Pine Facade And Scripts

Observed Pine/script endpoints:

- `GET pine-facade.tradingview.com/pine-facade/list`
- `GET pine-facade.tradingview.com/pine-facade/get_script_info/`
- `GET pine-facade.tradingview.com/pine-facade/versions/.../last`
- `GET pine-facade.tradingview.com/pine-facade/is_auth_to_get/...`
- `GET pine-facade.tradingview.com/pine-facade/translate/...`
- `POST pine-facade.tradingview.com/pine-facade/eval_pine_ex/`
- `POST www.tradingview.com/pubscripts-get/`
- `GET www.tradingview.com/pubscripts-library/`
- `GET www.tradingview.com/pubscripts-get/personal-access/`
- `GET www.tradingview.com/api/v1/script_packages/store/`

`eval_pine_ex` request shape:

```json
{
  "username": "string",
  "source": "string",
  "inputs": "string"
}
```

`translate` response shape includes:

```json
{
  "success": "boolean",
  "result": {
    "IL": "string",
    "ilTemplate": "string",
    "metaInfo": {
      "_metainfoVersion": "number",
      "description": "string",
      "docs": "string",
      "format": { "type": "string" },
      "inputs": ["object"],
      "plots": ["object"],
      "scriptIdPart": "string",
      "shortDescription": "string",
      "stats": "object",
      "styles": "object",
      "usedLibs": ["object"],
      "warnings": ["string"]
    }
  }
}
```

Pine list/library item shape includes script id/version/name/source/access/kind/stats plus author metadata. Full source bodies are intentionally not recorded here.

## Study Templates

Observed endpoint:

- `GET www.tradingview.com/api/v1/study-templates`

Response shape:

```json
{
  "custom": [],
  "standard": [{
    "id": "number",
    "name": "string",
    "meta_info": {
      "indicators": ["object"],
      "interval": "null"
    },
    "favorite_date": "null"
  }],
  "fundamentals": [{
    "id": "number",
    "name": "string",
    "meta_info": {
      "indicators": ["object"],
      "interval": "null"
    },
    "favorite_date": "null"
  }]
}
```

## News, Calendar, And Symbol Search

Runtime-proven unauthenticated-looking endpoints:

- `GET economic-calendar.tradingview.com/events`
- `GET news-mediator.tradingview.com/public/news-flow/v2/news`
- `GET news-mediator.tradingview.com/public/view/v1/symbol`
- `GET symbol-search.tradingview.com/symbol_search/v3/`

News flow response shape:

```json
{
  "items": [{
    "id": "string",
    "title": "string",
    "published": "number",
    "urgency": "number",
    "permission": "string",
    "relatedSymbols": ["object"],
    "storyPath": "string",
    "provider": {
      "id": "string",
      "name": "string",
      "logo_id": "string"
    }
  }],
  "streaming": { "channel": "string" },
  "pagination": { "cursor": "string" }
}
```

## Broker Panel And Fundamentals Config

`GET www.tradingview.com/api/v1/brokers/trading_panel` returns an array of broker records with ids, flags, country info, instrument types, referral links, ratings, plan metadata, integration names, and visible/hidden flags.

`GET www.tradingview.com/financial/fundamentals_config_v2/` returns field definitions with id, name, history support, pricescale/minmovement, hidden flag, type, visibility flags, formatter, allowed symbol types, category, parent, ordinal, and period.

## Implementation Notes

- Any Worker route derived from this file should require a fresh targeted fixture, because this artifact intentionally records shapes only.
- Read-only endpoints can be grouped separately from mutation endpoints. The HAR mostly proves read/list paths; alert, watchlist, layout, and chart mutation paths remain uncaptured.
- Auth classification should be endpoint-specific. Cookie/JWT presence in the HAR means authenticated observed, not necessarily authenticated required.
