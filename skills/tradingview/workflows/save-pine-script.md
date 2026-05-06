# Save Pine script

Persist Pine source as draft, saved, or published.

1. Decide the target lifecycle:
   - **Draft** — `mode: "new_draft"` (first time) or `mode: "next_draft"` with `id` (update). User-only autosave.
   - **Saved** — `mode: "new"` with `name` (first time) or `mode: "next"` with `id` (new version). Visible in the user's Pine library.
   - **Published** — `POST /v1/pine/publish` with `mode:"new"` (first publication, `access` ∈ `open|protected|invite_only`) or `mode:"next"` with `id` (update).
2. **Save**:
   ```json
   POST /v1/pine/save
   { "mode": "new", "name": "My RSI Variant", "source": "//@version=5\nindicator(...)\n..." }
   ```
   For new-version saves, set `mode:"next"`, `id:"USER;<id>"`, `allow_create_new` if you want fallback to a new script when the id is gone.
3. **Publish** (optional):
   ```json
   POST /v1/pine/publish
   { "mode": "new", "source": "...", "extra": { "title":"...", "description":"...", "agreementsAccepted": true }, "access": "open" }
   ```
   Publishing is irreversible; user must accept TradingView's publishing agreements client-side first. Surface `category:"validation"` with `details.upstreamReason:"agreements_required"` if not.
4. **Rename / delete** if needed via `POST /v1/pine/rename` and `POST /v1/pine/delete`.
5. Report the resulting `pineId` and `pineVersion`.

Caveats:
- `parse_title` (`POST /v1/pine/parse-title`) extracts the script name from the `indicator()` / `strategy()` / `library()` call. Useful for sanity checking before save.
- `convert` is for v4→v5 / v5→v6 migrations; the Worker exposes it under `POST /v1/pine/convert` (deferred).

Reference: `reference/pinescript.md`.
