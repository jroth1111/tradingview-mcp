# List indicators

Discover available indicators across built-in, public, and private surfaces.

1. **Built-in catalog**: `GET /v1/indicators/builtin?filter=standard|candlestick|fundamental` — bucketed list with `extra.kind`. The merged set has 1,520 unique IDs (144 standard, 45 candlestick, 1,332 fundamental).
2. **Public scripts (search)**: `GET /v1/pubscripts/suggest?q=<term>` for typeahead. For browsing, `GET /v1/pubscripts/library?sort=top|trending&type=1|2|3&offset=&count=20` (1=indicator, 2=strategy, 3=library).
3. **Editors picks**: `GET /v1/pubscripts/editors-picks?type=1`.
4. **Hydrate by id**: `POST /v1/pubscripts/batch` with `{ids:["PUB;<hash>", …]}` returns full metainfo for each.
5. **Private (user-saved)**: `POST /v1/indicators/private` returns the `USER;` namespace — drafts plus saved scripts.
6. **Combined search shortcut**: `POST /v1/indicators/search` merges builtin + public for a single query.

Filter strategies via `extra.kind === "strategy"`. There is no by-author or by-tag API; the TV indicator browser groups client-side.

Caveats: pubscripts has no rating/like/comment endpoint. There is no bulk metadata path for `STD;` IDs — call `POST /v1/indicators/meta` per indicator if you need full inputs.

Reference: `reference/indicators.md`, `reference/capabilities.md`.
