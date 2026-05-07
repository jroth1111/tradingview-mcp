#!/usr/bin/env python3
"""
Build an open-source Pine Script corpus and deterministic benchmark harness.

The collector uses TradingView public `scriptSource` fields only. It does not
fetch, decrypt, or transform protected TradingView artifacts.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


TV_WWW = "https://www.tradingview.com"
SUGGEST_ENDPOINT = f"{TV_WWW}/pubscripts-suggest-json/"
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)

DEFAULT_QUERIES = [
    "RSI",
    "MACD",
    "Bollinger",
    "Supertrend",
    "Moving Average",
    "VWAP",
    "ATR",
    "Stochastic",
    "ADX",
    "Ichimoku",
]

BENCHMARK_FIELDS = [
    "pine_version",
    "declaration_kind",
    "input_call_count",
    "plot_call_count",
    "strategy_action_count",
    "request_security_count",
    "uses_lookahead_on",
    "uses_negative_plot_offset",
    "uses_realtime_barstate",
    "potential_repaint_risk",
]


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, sort_keys=True) + "\n")


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open(encoding="utf-8") as f:
        for line_no, line in enumerate(f, start=1):
            if not line.strip():
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError as exc:
                raise SystemExit(f"{path}:{line_no}: invalid JSONL: {exc}") from exc
    return rows


def fetch_json(url: str, timeout: int = 30) -> Any:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "application/json,text/plain,*/*",
            "Referer": f"{TV_WWW}/",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = resp.read().decode("utf-8", errors="replace")
            return json.loads(data)
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code} for {url}: {body[:240]}") from exc


def source_split(source_sha256: str) -> str:
    bucket = int(source_sha256[:8], 16) % 10
    if bucket < 8:
        return "train"
    if bucket == 8:
        return "eval"
    return "test"


def pine_version(source: str) -> str:
    match = re.search(r"^\s*//@version\s*=\s*([0-9]+)", source, re.MULTILINE)
    return match.group(1) if match else "unknown"


def strip_comments(source: str) -> str:
    without_block = re.sub(r"/\*.*?\*/", "", source, flags=re.DOTALL)
    return re.sub(r"//.*", "", without_block)


def count_regex(pattern: str, source: str) -> int:
    return len(re.findall(pattern, source, flags=re.IGNORECASE | re.MULTILINE))


def declaration_kind(source: str) -> str:
    code = strip_comments(source)
    match = re.search(r"\b(strategy|indicator|library|study)\s*\(", code, re.IGNORECASE)
    if not match:
        return "unknown"
    kind = match.group(1).lower()
    return "indicator" if kind == "study" else kind


def analyze_source(source: str) -> dict[str, Any]:
    code = strip_comments(source)
    input_count = count_regex(r"\binput(?:\.[A-Za-z_][A-Za-z0-9_]*)?\s*\(", code)
    plot_count = count_regex(
        r"\b(plot|plotshape|plotchar|plotarrow|plotbar|plotcandle|hline|fill)\s*\(",
        code,
    )
    strategy_count = count_regex(r"\bstrategy\.(entry|order|exit|close|close_all)\s*\(", code)
    security_count = count_regex(r"\b(request\.security|security)\s*\(", code)
    lookahead_on = bool(re.search(r"lookahead\s*=\s*barmerge\.lookahead_on", code))
    negative_offset = bool(re.search(r"\boffset\s*=\s*-\s*[1-9][0-9]*", code))
    realtime_barstate = bool(re.search(r"\bbarstate\.(isrealtime|islast|isconfirmed)\b", code))
    return {
        "pine_version": pine_version(source),
        "declaration_kind": declaration_kind(source),
        "input_call_count": input_count,
        "plot_call_count": plot_count,
        "strategy_action_count": strategy_count,
        "request_security_count": security_count,
        "uses_lookahead_on": lookahead_on,
        "uses_negative_plot_offset": negative_offset,
        "uses_realtime_barstate": realtime_barstate,
        "potential_repaint_risk": bool(security_count or lookahead_on or negative_offset or realtime_barstate),
    }


def collect_corpus(args: argparse.Namespace) -> dict[str, Any]:
    out_dir = Path(args.out).resolve()
    sources_dir = out_dir / "sources"
    sources_dir.mkdir(parents=True, exist_ok=True)

    queries = normalize_queries(args.queries)
    seen_source_hashes: set[str] = set()
    seen_ids: set[str] = set()
    records: list[dict[str, Any]] = []
    collected_at = utc_now()

    for query in queries:
        params = urllib.parse.urlencode({"search": query, "limit": args.limit_per_query})
        data = fetch_json(f"{SUGGEST_ENDPOINT}?{params}")
        results = data.get("results", []) if isinstance(data, dict) else []
        if not isinstance(results, list):
            continue
        for item in results:
            if len(records) >= args.max_scripts:
                break
            source = item.get("scriptSource")
            script_id = item.get("scriptIdPart")
            if not isinstance(source, str) or not source.strip() or not script_id:
                continue
            digest = sha256_text(source)
            if digest in seen_source_hashes or script_id in seen_ids:
                continue

            seen_source_hashes.add(digest)
            seen_ids.add(script_id)
            rel_source_path = Path("sources") / f"{digest}.pine"
            source_path = out_dir / rel_source_path
            source_path.write_text(source, encoding="utf-8")

            analysis = analyze_source(source)
            records.append(
                {
                    "schema_version": "pine-corpus-record-v1",
                    "collected_at": collected_at,
                    "source_kind": "tradingview_public_scriptSource",
                    "script_id_part": script_id,
                    "title": item.get("scriptName") or item.get("title") or script_id,
                    "short_title": item.get("shortTitle"),
                    "author": author_name(item.get("author")),
                    "query": query,
                    "access": item.get("access"),
                    "type": item.get("type"),
                    "version": str(item.get("version", "")),
                    "source_path": rel_source_path.as_posix(),
                    "source_sha256": digest,
                    "source_bytes": len(source.encode("utf-8")),
                    "source_chars": len(source),
                    "line_count": len(source.splitlines()),
                    "split": source_split(digest),
                    "analysis": analysis,
                }
            )
        if len(records) >= args.max_scripts:
            break
        if args.delay_ms:
            time.sleep(args.delay_ms / 1000)

    manifest_path = out_dir / "manifest.jsonl"
    summary_path = out_dir / "summary.json"
    write_jsonl(manifest_path, records)
    summary = corpus_summary(records, queries)
    write_json(summary_path, summary)
    return {"manifest": manifest_path.as_posix(), "summary": summary_path.as_posix(), **summary}


def author_name(author: Any) -> str | None:
    if isinstance(author, dict):
        return author.get("username") or author.get("name")
    if isinstance(author, str):
        return author
    return None


def corpus_summary(records: list[dict[str, Any]], queries: list[str]) -> dict[str, Any]:
    splits: dict[str, int] = {}
    kinds: dict[str, int] = {}
    versions: dict[str, int] = {}
    for record in records:
        splits[record["split"]] = splits.get(record["split"], 0) + 1
        kind = record["analysis"]["declaration_kind"]
        kinds[kind] = kinds.get(kind, 0) + 1
        version = record["analysis"]["pine_version"]
        versions[version] = versions.get(version, 0) + 1
    return {
        "schema_version": "pine-corpus-summary-v1",
        "generated_at": utc_now(),
        "record_count": len(records),
        "total_source_bytes": sum(int(r["source_bytes"]) for r in records),
        "queries": queries,
        "splits": dict(sorted(splits.items())),
        "declaration_kinds": dict(sorted(kinds.items())),
        "pine_versions": dict(sorted(versions.items())),
    }


def build_benchmarks(args: argparse.Namespace) -> dict[str, Any]:
    corpus_dir = Path(args.corpus).resolve()
    manifest_path = corpus_dir / "manifest.jsonl"
    records = read_jsonl(manifest_path)
    out_dir = Path(args.out).resolve() if args.out else corpus_dir / "benchmarks"
    out_dir.mkdir(parents=True, exist_ok=True)

    tasks: list[dict[str, Any]] = []
    for record in records:
        if args.split != "all" and record["split"] != args.split:
            continue
        source = (corpus_dir / record["source_path"]).read_text(encoding="utf-8")
        expected = analyze_source(source)
        task_id = f"static-analysis-v1:{record['source_sha256'][:16]}"
        tasks.append(
            {
                "schema_version": "pine-benchmark-task-v1",
                "task_id": task_id,
                "task_type": "static_analysis_v1",
                "split": record["split"],
                "script_id_part": record["script_id_part"],
                "title": record["title"],
                "source_path": record["source_path"],
                "source_sha256": record["source_sha256"],
                "prompt": render_static_analysis_prompt(source),
                "expected": expected,
                "grading_fields": BENCHMARK_FIELDS,
            }
        )

    tasks_path = out_dir / "tasks.jsonl"
    summary_path = out_dir / "summary.json"
    schema_path = out_dir / "prediction.schema.json"
    write_jsonl(tasks_path, tasks)
    write_json(schema_path, prediction_schema())
    summary = benchmark_summary(tasks)
    write_json(summary_path, summary)
    return {
        "tasks": tasks_path.as_posix(),
        "prediction_schema": schema_path.as_posix(),
        "summary": summary_path.as_posix(),
        **summary,
    }


def render_static_analysis_prompt(source: str) -> str:
    return (
        "Analyze this TradingView Pine Script. Respond with JSON only, using exactly these keys: "
        + ", ".join(BENCHMARK_FIELDS)
        + ". Counts must be integers. Boolean fields must be true or false.\n\n"
        "```pine\n"
        + source
        + "\n```"
    )


def prediction_schema() -> dict[str, Any]:
    properties: dict[str, Any] = {
        "pine_version": {"type": "string"},
        "declaration_kind": {"enum": ["indicator", "strategy", "library", "unknown"]},
    }
    for field in [
        "input_call_count",
        "plot_call_count",
        "strategy_action_count",
        "request_security_count",
    ]:
        properties[field] = {"type": "integer", "minimum": 0}
    for field in [
        "uses_lookahead_on",
        "uses_negative_plot_offset",
        "uses_realtime_barstate",
        "potential_repaint_risk",
    ]:
        properties[field] = {"type": "boolean"}
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "title": "Pine static-analysis prediction",
        "type": "object",
        "required": ["task_id", "answer"],
        "properties": {
            "task_id": {"type": "string"},
            "answer": {
                "type": "object",
                "required": BENCHMARK_FIELDS,
                "properties": properties,
                "additionalProperties": True,
            },
        },
        "additionalProperties": True,
    }


def benchmark_summary(tasks: list[dict[str, Any]]) -> dict[str, Any]:
    splits: dict[str, int] = {}
    for task in tasks:
        splits[task["split"]] = splits.get(task["split"], 0) + 1
    return {
        "schema_version": "pine-benchmark-summary-v1",
        "generated_at": utc_now(),
        "task_count": len(tasks),
        "task_type": "static_analysis_v1",
        "splits": dict(sorted(splits.items())),
        "grading_fields": BENCHMARK_FIELDS,
    }


def write_baseline(args: argparse.Namespace) -> dict[str, Any]:
    tasks_path = Path(args.tasks).resolve()
    tasks = read_jsonl(tasks_path)
    corpus_dir = Path(args.corpus).resolve() if args.corpus else tasks_path.parent.parent
    out_path = Path(args.out).resolve()
    predictions: list[dict[str, Any]] = []

    for task in tasks:
        source_path = corpus_dir / task["source_path"]
        source = source_path.read_text(encoding="utf-8")
        predictions.append(
            {
                "task_id": task["task_id"],
                "model": "static-parser-baseline-v1",
                "answer": analyze_source(source),
            }
        )

    write_jsonl(out_path, predictions)
    return {"predictions": out_path.as_posix(), "prediction_count": len(predictions)}


def grade_predictions(args: argparse.Namespace) -> dict[str, Any]:
    tasks_path = Path(args.tasks).resolve()
    tasks = read_jsonl(tasks_path)
    predictions = {row.get("task_id"): row for row in read_jsonl(Path(args.predictions).resolve())}

    field_totals = {field: 0 for field in BENCHMARK_FIELDS}
    field_correct = {field: 0 for field in BENCHMARK_FIELDS}
    failures: list[dict[str, Any]] = []
    exact_correct = 0
    missing = 0

    for task in tasks:
        task_id = task["task_id"]
        prediction = predictions.get(task_id)
        if not prediction:
            missing += 1
            failures.append({"task_id": task_id, "reason": "missing_prediction"})
            continue
        answer = prediction.get("answer", prediction)
        task_exact = True
        for field in task.get("grading_fields", BENCHMARK_FIELDS):
            expected = task["expected"].get(field)
            actual = answer.get(field) if isinstance(answer, dict) else None
            field_totals[field] += 1
            if actual == expected:
                field_correct[field] += 1
            else:
                task_exact = False
                if len(failures) < args.max_failures:
                    failures.append(
                        {
                            "task_id": task_id,
                            "field": field,
                            "expected": expected,
                            "actual": actual,
                        }
                    )
        if task_exact:
            exact_correct += 1

    report = {
        "schema_version": "pine-benchmark-grade-v1",
        "graded_at": utc_now(),
        "tasks": len(tasks),
        "predictions": len(predictions),
        "missing_predictions": missing,
        "exact_match_count": exact_correct,
        "exact_match_rate": exact_correct / len(tasks) if tasks else 0,
        "field_accuracy": {
            field: (field_correct[field] / field_totals[field] if field_totals[field] else 0)
            for field in BENCHMARK_FIELDS
        },
        "failures": failures,
    }
    if args.out:
        write_json(Path(args.out).resolve(), report)
    return report


def self_test(_: argparse.Namespace) -> dict[str, Any]:
    temp = Path(tempfile.mkdtemp(prefix="pine-ml-corpus-self-test-"))
    try:
        corpus = temp / "corpus"
        sources = corpus / "sources"
        sources.mkdir(parents=True)
        samples = [
            (
                "sample-rsi",
                '//@version=5\nindicator("Sample RSI")\nlen = input.int(14)\nplot(ta.rsi(close, len))\n',
            ),
            (
                "sample-strategy",
                '//@version=5\nstrategy("Sample Strategy")\nif close > open\n    strategy.entry("L", strategy.long)\n',
            ),
        ]
        records: list[dict[str, Any]] = []
        for script_id, source in samples:
            digest = sha256_text(source)
            rel = Path("sources") / f"{digest}.pine"
            (corpus / rel).write_text(source, encoding="utf-8")
            records.append(
                {
                    "schema_version": "pine-corpus-record-v1",
                    "collected_at": utc_now(),
                    "source_kind": "self_test_fixture",
                    "script_id_part": script_id,
                    "title": script_id,
                    "source_path": rel.as_posix(),
                    "source_sha256": digest,
                    "source_bytes": len(source.encode("utf-8")),
                    "source_chars": len(source),
                    "line_count": len(source.splitlines()),
                    "split": source_split(digest),
                    "analysis": analyze_source(source),
                }
            )
        write_jsonl(corpus / "manifest.jsonl", records)
        build_result = build_benchmarks(argparse.Namespace(corpus=corpus, out=None, split="all"))
        tasks_path = Path(build_result["tasks"])
        pred_path = corpus / "benchmarks" / "baseline.predictions.jsonl"
        write_baseline(argparse.Namespace(tasks=tasks_path, corpus=corpus, out=pred_path))
        grade = grade_predictions(
            argparse.Namespace(
                tasks=tasks_path,
                predictions=pred_path,
                out=None,
                max_failures=10,
            )
        )
        if grade["exact_match_rate"] != 1:
            raise SystemExit(f"self-test failed: {json.dumps(grade, indent=2)}")
        return {"self_test": "passed", "temp_dir_removed": temp.as_posix(), "grade": grade}
    finally:
        shutil.rmtree(temp, ignore_errors=True)


def normalize_queries(values: list[str] | None) -> list[str]:
    if not values:
        return DEFAULT_QUERIES
    queries: list[str] = []
    for value in values:
        for part in value.split(","):
            part = part.strip()
            if part:
                queries.append(part)
    return queries or DEFAULT_QUERIES


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    collect = sub.add_parser("collect", help="Collect public open-source Pine scriptSource records.")
    collect.add_argument("--out", required=True, help="Output corpus directory.")
    collect.add_argument("--queries", nargs="*", help="Search queries, comma-separated or repeated.")
    collect.add_argument("--max-scripts", type=int, default=100)
    collect.add_argument("--limit-per-query", type=int, default=100)
    collect.add_argument("--delay-ms", type=int, default=100)
    collect.set_defaults(func=collect_corpus)

    bench = sub.add_parser("build-benchmark", help="Build static-analysis benchmark tasks.")
    bench.add_argument("--corpus", required=True, help="Corpus directory containing manifest.jsonl.")
    bench.add_argument("--out", help="Output benchmark directory. Defaults to <corpus>/benchmarks.")
    bench.add_argument("--split", choices=["all", "train", "eval", "test"], default="all")
    bench.set_defaults(func=build_benchmarks)

    baseline = sub.add_parser("baseline", help="Write static parser baseline predictions.")
    baseline.add_argument("--tasks", required=True, help="tasks.jsonl path.")
    baseline.add_argument("--out", required=True, help="Prediction JSONL path.")
    baseline.add_argument("--corpus", help="Corpus directory. Defaults to tasks parent parent.")
    baseline.set_defaults(func=write_baseline)

    grade = sub.add_parser("grade", help="Grade JSONL predictions against benchmark tasks.")
    grade.add_argument("--tasks", required=True, help="tasks.jsonl path.")
    grade.add_argument("--predictions", required=True, help="Prediction JSONL path.")
    grade.add_argument("--out", help="Grade report JSON path.")
    grade.add_argument("--max-failures", type=int, default=20)
    grade.set_defaults(func=grade_predictions)

    test = sub.add_parser("self-test", help="Run offline harness self-test.")
    test.set_defaults(func=self_test)
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    result = args.func(args)
    print(json.dumps(result, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
