# TradingView Pine ML Corpus And Benchmark Harness - 2026-05-07

## Scope

`ml/pine_ml_corpus.py` builds a small, reproducible ML evaluation corpus from public TradingView Pine `scriptSource` records. It is intentionally source-only and open-source-only:

- Uses `https://www.tradingview.com/pubscripts-suggest-json/`.
- Keeps only records with a non-empty public `scriptSource`.
- Does not fetch, decrypt, transform, or reverse protected `ilTemplate` artifacts.
- Writes third-party source artifacts under a user-selected output directory. Use `probe-output/` for local samples because it is gitignored.

## Commands

Collect a sample corpus:

```bash
python3 ml/pine_ml_corpus.py collect \
  --out probe-output/pine-ml-corpus-2026-05-07 \
  --max-scripts 25 \
  --queries RSI MACD Bollinger Supertrend
```

Build benchmark tasks:

```bash
python3 ml/pine_ml_corpus.py build-benchmark \
  --corpus probe-output/pine-ml-corpus-2026-05-07
```

Write deterministic static-parser baseline predictions:

```bash
python3 ml/pine_ml_corpus.py baseline \
  --tasks probe-output/pine-ml-corpus-2026-05-07/benchmarks/tasks.jsonl \
  --out probe-output/pine-ml-corpus-2026-05-07/benchmarks/baseline.predictions.jsonl
```

Grade any model prediction JSONL against the benchmark:

```bash
python3 ml/pine_ml_corpus.py grade \
  --tasks probe-output/pine-ml-corpus-2026-05-07/benchmarks/tasks.jsonl \
  --predictions probe-output/pine-ml-corpus-2026-05-07/benchmarks/baseline.predictions.jsonl \
  --out probe-output/pine-ml-corpus-2026-05-07/benchmarks/baseline.grade.json
```

Run the offline fixture self-test:

```bash
python3 ml/pine_ml_corpus.py self-test
```

## Artifact Layout

The collector writes:

```text
<corpus>/
  manifest.jsonl
  summary.json
  sources/
    <source_sha256>.pine
```

`manifest.jsonl` stores one row per deduped source with script metadata, source path, SHA-256, source length, deterministic split, and static analysis fields. Splits are derived from the source hash: 80 percent train, 10 percent eval, 10 percent test.

The benchmark builder writes:

```text
<corpus>/benchmarks/
  tasks.jsonl
  prediction.schema.json
  summary.json
```

Each task is `static_analysis_v1`. The prompt contains the public Pine source and asks a model to return JSON with these fields:

```text
pine_version
declaration_kind
input_call_count
plot_call_count
strategy_action_count
request_security_count
uses_lookahead_on
uses_negative_plot_offset
uses_realtime_barstate
potential_repaint_risk
```

Prediction JSONL rows should have this shape:

```json
{"task_id":"static-analysis-v1:<id>","answer":{"pine_version":"5","declaration_kind":"indicator"}}
```

The `answer` object must include every field listed in `prediction.schema.json`. Extra top-level or answer fields are ignored by the grader.

## Live Sample Result

Live sample command:

```bash
python3 ml/pine_ml_corpus.py collect --out probe-output/pine-ml-corpus-2026-05-07 --max-scripts 25 --queries RSI MACD Bollinger Supertrend
```

Result:

- Records: 25
- Total source bytes: 41,564
- Declaration kinds: 20 indicators, 5 strategies
- Splits: 21 train, 1 eval, 3 test
- Pine versions: 5 with `//@version=2`, 20 with no version directive and therefore recorded as `unknown`

Benchmark and baseline grading:

- `build-benchmark`: wrote 25 tasks plus `prediction.schema.json`
- `baseline`: wrote 25 predictions
- `grade`: exact match rate 1.0, no failures

The live corpus artifacts are intentionally not committed.

## Verification

Commands run from `/Users/gwizz/CascadeProjects/Trading/tradingview`:

```bash
python3 -m py_compile ml/pine_ml_corpus.py
python3 ml/pine_ml_corpus.py self-test
python3 ml/pine_ml_corpus.py collect --out probe-output/pine-ml-corpus-2026-05-07 --max-scripts 25 --queries RSI MACD Bollinger Supertrend
python3 ml/pine_ml_corpus.py build-benchmark --corpus probe-output/pine-ml-corpus-2026-05-07
python3 ml/pine_ml_corpus.py build-benchmark --corpus probe-output/pine-ml-corpus-2026-05-07 --split test --out probe-output/pine-ml-corpus-2026-05-07/benchmarks-test-split
python3 ml/pine_ml_corpus.py baseline --tasks probe-output/pine-ml-corpus-2026-05-07/benchmarks/tasks.jsonl --out probe-output/pine-ml-corpus-2026-05-07/benchmarks/baseline.predictions.jsonl
python3 ml/pine_ml_corpus.py grade --tasks probe-output/pine-ml-corpus-2026-05-07/benchmarks/tasks.jsonl --predictions probe-output/pine-ml-corpus-2026-05-07/benchmarks/baseline.predictions.jsonl --out probe-output/pine-ml-corpus-2026-05-07/benchmarks/baseline.grade.json
```

The offline self-test used two generated fixture scripts and produced exact-match rate 1.0. The live sample used only public `scriptSource` records and wrote all third-party source material under `probe-output/`.
