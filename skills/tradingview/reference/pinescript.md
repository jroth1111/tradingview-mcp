# Pine reference

PineScript v5/v6 compile, run, save, publish, delete, rename. Authority: `pine-facade.tradingview.com` for Pine code, `data.tradingview.com` for execution.

## Compile pipeline

Three modes with different upstream paths:

| Mode | Upstream | Body | Returns |
| --- | --- | --- | --- |
| `light` | `POST /pine-facade/translate_light/?pine_id=<id>` | `{source}` | metaInfo only (no IL). Used by alert editor. |
| `full` | `POST /pine-facade/translate_source/{ver}?is_pine_ex=true` | `{source, inputs?}` | `{success, result:{metaInfo, ilTemplate, rootValues?, errors:[], warnings:[]}}` |
| `eval` | `POST /pine-facade/eval_pine_ex/` | form: `username, source, inputs` (URL-encoded) | `{success, result:{rootValues:{rm_<n>:value}}}` |

`is_pine_ex=true` toggles the `eval_pine_ex` preprocessor on `translate_source` — it expands `##input(...)` and `##root(...)` macros. The Worker forwards the flag verbatim.

## `eval_pine_ex` is metainfo only

`eval_pine_ex` does **not** run a strategy or compute plot output. It resolves `##root(...)` placeholders and returns a `rootValues` map keyed by `rm_<n>`. Use it for:

- Resolving default values for inputs before a real run.
- Quick syntax validation without a chart session.

To get plot output, you must run via `create_study` (see `wire-formats.md`).

## `rm_*` are plot-arg slots, NOT input mirrors

The `rm_<n>` keys in `rootValues` correspond to `##root(root_metainfo, rm_<n>, …)` placeholders inside the source body, NOT to the `in_<n>` input wire indices. Mapping `rm_*` to `in_*` requires reading the source. Don't conflate.

## Error envelope

Pine compile errors come back as:

```json
{
  "success": false,
  "result": {
    "errors": [
      { "message": "Undeclared identifier 'foo'", "start": {"line": 12, "column": 5}, "end": {"line": 12, "column": 8} }
    ],
    "warnings": [],
    "reason": "compile_error",
    "reason2": "Undeclared identifier"
  }
}
```

The Worker normalises to `{category:"validation", details:{errors[], warnings[]}}` for `/v1/pine/compile` callers.

## Save / publish CRUD

All cookie-authed POSTs to `pine-facade.tradingview.com`. Bodies are JSON.

| Verb | Path | Body | Notes |
| --- | --- | --- | --- |
| Save new | `POST /pine-facade/save/new?name={name}&allow_overwrite=…` | `{source}` | First-time save under a name. |
| Save new draft | `POST /pine-facade/save/new_draft?allow_use_existing_draft=…` | `{source}` | |
| Save next | `POST /pine-facade/save/next/{id}?allow_create_new=…&name=…` | `{source}` | New version of existing script. |
| Save next draft | `POST /pine-facade/save/next_draft/{id}?allow_create_new=…` | `{source}` | |
| Publish new | `POST /pine-facade/publish/new/?access=…` | `{source, extra}` | First publication; `access` ∈ `open|protected|invite_only`. |
| Publish next | `POST /pine-facade/publish/next/{id}` | `{source, extra}` | Update published version. |
| Delete | `POST /pine-facade/delete/{id}` | empty | |
| Rename | `POST /pine-facade/rename/{id}?name={name}&force=…` | empty | |
| Rename version | `PUT /pine-facade/name/{id}/{ver}?name={name}` | empty | |
| Get source | `GET /pine-facade/get/{id}/{ver}?no_4xx=…` | | Raw source. |
| Versions | `GET /pine-facade/versions/{id}/{last|all}` | | |
| Auth check | `GET /pine-facade/is_auth_to_get/{id}/{ver}` | | Truthy = caller can read. |
| Auth check (write) | `GET /pine-facade/is_auth_to_write/{id}/{ver}` | | |
| Parse title | `POST /pine-facade/parse_title` | `{source}` | Extracts `title=` from script header. |
| Convert | `POST /pine-facade/convert` | `{source, version_to}` | v4→v5, v5→v6. |
| gen_alert | `POST /pine-facade/gen_alert/` | `{alert_info}` | First phase of Pine alert creation; second phase is `pricealerts/create_alert`. |

## Worker route mapping

| Worker route | Upstream | Notes |
| --- | --- | --- |
| `POST /v1/pine/compile` | `/eval_pine_ex/`, `/translate_source/{ver}`, or `/translate_light/?pine_id=` | Mode-driven. |
| `POST /v1/pine/run` | compile → `create_study` with `Script$<id>@tv-scripting-101!` | Returns plot output, see `wire-formats.md`. |
| `POST /v1/pine/save` | `/save/{new,new_draft,next,next_draft}` | Mode-driven. |
| `POST /v1/pine/publish` | `/publish/{new,next}` | |
| `POST /v1/pine/delete` | `/delete/{id}` | |
| `POST /v1/pine/rename` | `/rename/{id}` | |
| `POST /v1/pine/parse-title` | `/parse_title` | |

`packages/tradingview-core/src/pine/types.ts` already types these payloads; the Worker should import from there rather than duplicating.

## Pine v6 considerations

Pine v6 introduced strict syntax around `series<float>` vs `simple<float>` and richer matrix types. The compile envelope is unchanged. Some indicators expose a v6-only flag inside `extra` on metainfo; the Worker should pass through verbatim.

## Closed-source scripts

`is_auth_to_get` returns truthy when the user has permission to read source (paid invite, owner, public). Falsy means the script can only be referenced by `pineId`/`pineVersion` — the Worker can still run it via `Script$<id>@tv-scripting-101!` because TV resolves source server-side. See `strategies.md` for the closed-source backtest workflow.

## What does NOT exist

Common asks that have no upstream surface:

- No "compile and return AST" — only IL template via `translate_source`.
- No "run with a custom timezone" — timezone is per chart session via `switch_timezone`, not per Pine call.
- No "lint without compile" — use `parse_title` for syntactic header check only; full linting requires a compile.
- No "diff two versions" — the Worker would have to GET both and diff client-side.
