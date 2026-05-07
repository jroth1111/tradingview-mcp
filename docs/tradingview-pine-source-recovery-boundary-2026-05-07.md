# TradingView Pine Source Recovery Boundary Exercises - 2026-05-07

## Scope

Source requirement: continue the remaining exercises from the ilTemplate/plaintext thread without bypassing TradingView protections.

Safety boundary: this run did not attempt protected-source recovery, TradingView key recovery, or decryption of TradingView ilTemplate artifacts. It used public open-source `scriptSource` records and local controlled AES-GCM only.

External-call rollback: none. These were read-only public GET/POST/WebSocket probes, bounded by `--max-open=20`, `--max-assets=60`, and `--bars=30`; no cookies were sent.

Command:

```bash
node scripts/probes/pine-recovery-exercises.mjs --max-open 20 --max-assets 60 --bars 30 --docs-out docs/tradingview-pine-source-recovery-boundary-2026-05-07.md
```

Working directory: `/Users/gwizz/CascadeProjects/Trading/tradingview`

Started: `2026-05-07T09:00:28.308Z`

## Exercise 1 - Runtime And Client-Key Evidence

Positive probe: capture the public study WebSocket path and check what the client sends for `Script$PUB;568@tv-scripting-72!`.

Result: `create_study` sent the indicator identifier plus metadata default inputs. The sent frames contained the opaque encrypted IL default input only when required by the metadata. They did not contain plaintext Pine source.

Sent frame names: `set_auth_token`, `chart_create_session`, `switch_timezone`, `resolve_symbol`, `create_series`, `create_study`

Received frame names: `series_loading`, `symbol_resolved`, `timescale_update`, `series_completed`, `study_error`

Study runtime result: `study_error`

Negative probe: scan chart JavaScript assets for client decrypt/key indicators and observed key ids.

Bundle assets discovered: 50; fetched: 50; fetch failures: 0; bytes searched: 3948399.

Decrypt/key hit count: 0

Sent contained encrypted key id marker: yes

Sent contained plaintext Pine source: no

Interpretation: this run found no evidence that the browser holds a decryption key or decrypts `ilTemplate` back to Pine source. The direct public-script study attempt returned `study_error`, so this is wire-payload evidence rather than successful plot-output evidence. For the decryption question, the material finding is that the client sent an ID plus opaque encrypted artifact and no plaintext Pine source.

## Exercise 2 - Length Comparison

| Script | Title | source bytes | cipher bytes | cipher/source | key id |
| --- | --- | ---: | ---: | ---: | --- |
| `PUB;2187` | Bollinger + RSI, Double Strategy (by ChartArt) v1.1 | 2801 | 1385 | 0.4945 | `bmI9Ks46` |
| `PUB;568` | CM RSI-2 Strategy Lower Indicator | 953 | 328 | 0.3442 | `bmI9Ks46` |
| `PUB;131` | RSI Candles | 587 | 312 | 0.5315 | `bmI9Ks46` |
| `PUB;454` | CM_Ultimate RSI Multi Time Frame | 2764 | 1095 | 0.3962 | `bmI9Ks46` |
| `PUB;197` | RSI Bands, RSI %B and RSI Bandwidth | 843 | 365 | 0.433 | `bmI9Ks46` |
| `PUB;370` | RSI HistoAlert Strategy | 1045 | 333 | 0.3187 | `bmI9Ks46` |
| `PUB;567` | CM RSI-2 Strategy - Upper Indicators. | 1559 | 768 | 0.4926 | `bmI9Ks46` |
| `PUB;19` | Indicator: MFI or RSI enclosed by Bollinger Bands | 1319 | 583 | 0.442 | `bmI9Ks46` |
| `PUB;1897` | Stochastic + RSI, Double Strategy (by ChartArt) | 2023 | 1310 | 0.6476 | `bmI9Ks46` |
| `PUB;72` | RSI Strategy | 983 | 228 | 0.2319 | `bmI9Ks46` |
| `PUB;2169` | Bollinger + RSI, Double Strategy (by ChartArt) | 2793 | 1459 | 0.5224 | `bmI9Ks46` |
| `PUB;1343` | Premier RSI Oscillator [LazyBear] | 1082 | 518 | 0.4787 | `bmI9Ks46` |
| `PUB;40` | MacD Custom Indicator-Multiple Time Frame+All Available Options! | 2842 | 986 | 0.3469 | `bmI9Ks46` |
| `PUB;2004` | MACD + SMA 200 Strategy (by ChartArt) | 3147 | 1930 | 0.6133 | `bmI9Ks46` |
| `PUB;1146` | MACD 4C | 592 | 249 | 0.4206 | `bmI9Ks46` |
| `PUB;129` | MACD Crossover | 2343 | 286 | 0.1221 | `bmI9Ks46` |
| `PUB;1332` | MACD_VXI | 685 | 292 | 0.4263 | `bmI9Ks46` |
| `PUB;983` | AK MACD BB INDICATOR V  1.00 | 1034 | 382 | 0.3694 | `bmI9Ks46` |
| `PUB;1275` | Impulse MACD [LazyBear] | 1057 | 457 | 0.4324 | `bmI9Ks46` |
| `PUB;533` | MACD Leader [LazyBear] | 815 | 369 | 0.4528 | `bmI9Ks46` |

Average cipher/source byte ratio: 0.4259

Interpretation: the encrypted artifact is not plain Pine source encrypted byte-for-byte. The size profile is consistent with a lower-level compiled/serialized representation before encryption.

## Exercise 3 - Open-Source Pine Corpus

Corpus records: 20

Total source bytes: 31267

Artifacts:

- `probe-output/pine-recovery-2026-05-07T09-00-28-307Z/open-source-pine-corpus.jsonl`
- `probe-output/pine-recovery-2026-05-07T09-00-28-307Z/open-source-pine-corpus-manifest.json`

The JSONL corpus is gitignored under `probe-output/` and contains only public records where `scriptSource` was non-empty.

## Exercise 4 - Controlled Local Crypto Benchmark

| Script | raw AES-GCM decrypts to source | deflate+AES-GCM inflates to source | compiled surrogate decrypts to source |
| --- | ---: | ---: | ---: |
| `PUB;2187` | yes | yes | no |
| `PUB;568` | yes | yes | no |
| `PUB;131` | yes | yes | no |
| `PUB;454` | yes | yes | no |
| `PUB;197` | yes | yes | no |
| `PUB;370` | yes | yes | no |
| `PUB;567` | yes | yes | no |
| `PUB;19` | yes | yes | no |
| `PUB;1897` | yes | yes | no |
| `PUB;72` | yes | yes | no |
| `PUB;2169` | yes | yes | no |
| `PUB;1343` | yes | yes | no |
| `PUB;40` | yes | yes | no |
| `PUB;2004` | yes | yes | no |
| `PUB;1146` | yes | yes | no |
| `PUB;129` | yes | yes | no |
| `PUB;1332` | yes | yes | no |
| `PUB;983` | yes | yes | no |
| `PUB;1275` | yes | yes | no |
| `PUB;533` | yes | yes | no |

Result: raw and compressed local encryption round-tripped to the original Pine source when the key and exact preimage were controlled locally. The compiled-surrogate path decrypted successfully but did not produce source, by construction.

Interpretation: the controlled exercise demonstrates why the TradingView case is different. Even with a valid decrypt operation, if the encrypted plaintext is bytecode or an intermediate representation, source recovery is a decompilation problem, not simple decryption.

## Artifacts

- Summary: `probe-output/pine-recovery-2026-05-07T09-00-28-307Z/summary.md`
- Evidence JSON: `probe-output/pine-recovery-2026-05-07T09-00-28-307Z/evidence.json`
- Length comparison: `probe-output/pine-recovery-2026-05-07T09-00-28-307Z/length-comparison.json`
- Bundle scan: `probe-output/pine-recovery-2026-05-07T09-00-28-307Z/bundle-scan-summary.json`
- Study wire JSONL: `probe-output/pine-recovery-2026-05-07T09-00-28-307Z/study-wire.jsonl`
- Controlled benchmark: `probe-output/pine-recovery-2026-05-07T09-00-28-307Z/controlled-crypto-benchmark.json`
