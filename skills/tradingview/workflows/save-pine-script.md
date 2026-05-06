# Save Pine script

Persist Pine source as draft, saved, or published.

1. Decide the target lifecycle:
   - **Draft** — `mode: "new_draft"` (first time) or `mode: "next_draft"` with `id` (update). User-only autosave.
   - **Saved** — `mode: "new"` with `name` (first time) or `mode: "next"` with `id` (new version). Visible in the user's Pine library.
   - **Published** — `POST /v1/pine/publish` with `mode:"new"` (first publication, `access` ∈ `open|protected|invite_only`) or `mode:"next"` with `id` (update).
2. (Optional) **Validate the title** before save with `POST /v1/pine/parse-title { "source": "..." }`. The Worker proxies `pine-facade/parse_title` and returns `{title, shortTitle, scriptKind}`. Use the returned `title` as the `name` for `save/new` to keep the user-visible name in sync with the Pine `indicator()`/`strategy()` declaration.
3. **Save** (Worker route → upstream):
   - `mode:"new"` → `POST pine-facade/save/new?name=<name>&allow_overwrite=<bool>` body `source=<urlencoded>`
   - `mode:"next"` → `POST pine-facade/save/next/<id>?allow_create_new=<bool>&name=<name?>` body `source=<urlencoded>`
   - `mode:"new_draft"` → `POST pine-facade/save/new_draft?allow_use_existing_draft=<bool>` body `source=<urlencoded>`
   - `mode:"next_draft"` → `POST pine-facade/save/next_draft/<id>?allow_create_new=<bool>` body `source=<urlencoded>`
   ```json
   POST /v1/pine/save
   {
     "mode": "new",
     "name": "My RSI Variant",
     "source": "//@version=5\nindicator(...)\n...",
     "allowOverwrite": false
   }
   ```
   Response: `{success, scriptIdPart, version, errors[], warnings[]}`. `errors[]` items carry `{message, line, column}` flattened from the TV `reason2.errors` envelope; surface verbatim with line/column on validation failures.
4. **Publish** (optional):
   ```json
   POST /v1/pine/publish
   {
     "mode": "new",
     "source": "...",
     "extra": { "title":"...", "description":"...", "agreementsAccepted": true, "originalScriptId":"USER;<id>", "originalScriptVersion":"1.0" },
     "access": "open"
   }
   ```
   Worker maps `mode:"new"` → `POST pine-facade/publish/new/?access=<a>` and `mode:"next"` → `POST pine-facade/publish/next/<id>`. `extra` is JSON-serialised into the form body. Publishing is irreversible; the user must accept TradingView's publishing agreements client-side first. Surface `category:"validation"` with `details.upstreamReason:"agreements_required"` if not.
5. **Rename / copy / delete** if needed:
   - `POST /v1/pine/rename` `{id, name, force?}` → `pine-facade/rename/<id>`
   - `POST /v1/pine/copy` `{id, name?}` → `pine-facade/copy/<id>` (returns the new `scriptIdPart`)
   - `POST /v1/pine/delete` `{id}` → `pine-facade/delete/<id>`
6. Report the resulting `pineId` (`scriptIdPart`) and `pineVersion`.

Caveats:
- `parse_title` (`POST /v1/pine/parse-title`) extracts the script name from the `indicator()` / `strategy()` / `library()` call. Useful for sanity checking before save.
- `convert` (`POST /v1/pine/convert {source, version_to}`) is for v4→v5 / v5→v6 migrations; the Worker proxies `pine-facade/convert` and returns `{success, source, errors[], warnings[]}`.

Reference: `reference/pinescript.md`.
