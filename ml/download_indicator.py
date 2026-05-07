#!/usr/bin/env python3
"""
Download TradingView indicator signal data via the Worker API for ML pipelines.

Usage:
    python download_indicator.py [OPTIONS]

Required env vars:
    WORKER_URL      e.g. https://tradingview-data.gwizz.workers.dev
    HMAC_SECRET     shared secret configured in the Worker
    HMAC_CLIENT_ID  client identifier (e.g. "ml-pipeline")

Optional env vars:
    TV_SESSION_ID   override stored TradingView session (debugging only)
    TV_SESSION_SIGN override stored TradingView session sign (debugging only)

Examples:
    # Discover indicator ID then exit
    python download_indicator.py --search "Algorganic"

    # Download 5000 bars of 1H data for BTCUSDT
    python download_indicator.py \\
        --indicator PUB;xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx \\
        --symbols BINANCE:BTCUSDT NASDAQ:AAPL \\
        --timeframe 60 \\
        --bars 5000 \\
        --out signals.csv
"""

import argparse
import csv
import hashlib
import hmac
import json
import os
import sys
import time
from pathlib import Path
from urllib.parse import urlparse

# ---------------------------------------------------------------------------
# HMAC auth helpers
# ---------------------------------------------------------------------------

def _sign(method: str, path: str, body_bytes: bytes, ts: int, secret: str) -> str:
    body_hash = hashlib.sha256(body_bytes).hexdigest()
    canonical = f"{method}\n{path}\n{body_hash}\n{ts}"
    sig = hmac.new(secret.encode(), canonical.encode(), hashlib.sha256).hexdigest()
    return sig


def _headers(method: str, path: str, body: dict | None, secret: str, client_id: str) -> dict:
    body_bytes = json.dumps(body).encode() if body else b""
    ts = int(time.time() * 1000)
    sig = _sign(method, path, body_bytes, ts, secret)
    return {
        "Content-Type": "application/json",
        "Authorization": f"HMAC {client_id}:{sig}",
        "X-Timestamp": str(ts),
    }


# ---------------------------------------------------------------------------
# Worker API calls
# ---------------------------------------------------------------------------

def _call(method: str, path: str, body: dict | None, cfg: dict) -> dict:
    import urllib.request
    import urllib.error

    url = cfg["worker_url"].rstrip("/") + path
    headers = _headers(method, path, body, cfg["secret"], cfg["client_id"])
    body_bytes = json.dumps(body).encode() if body else None

    req = urllib.request.Request(url, data=body_bytes, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body_text = e.read().decode(errors="replace")
        raise RuntimeError(f"HTTP {e.code} {e.reason}: {body_text}") from e


def search_indicator(query: str, cfg: dict) -> list[dict]:
    """Search public indicator catalog by name."""
    resp = _call("POST", "/v1/indicators/search", {"query": query}, cfg)
    return resp.get("result", [])


def get_indicator_meta(indicator_id: str, cfg: dict) -> dict:
    """Fetch indicator metadata including plot definitions."""
    body: dict = {"id": indicator_id}
    resp = _call("POST", "/v1/indicators/meta", body, cfg)
    return resp.get("result", {})


def run_study(
    symbol: str,
    indicator_id: str,
    timeframe: str,
    bars: int,
    inputs: dict | None,
    cfg: dict,
) -> dict:
    """Run the indicator via the Worker WebSocket bridge and return plot data."""
    body: dict = {
        "symbol": symbol,
        "studyId": indicator_id,
        "timeframe": timeframe,
        "bars": bars,
    }
    if inputs:
        body["inputs"] = inputs
    resp = _call("POST", "/v1/study", body, cfg)
    return resp.get("result", {})


# ---------------------------------------------------------------------------
# Data extraction
# ---------------------------------------------------------------------------

def extract_rows(study_result: dict, symbol: str, timeframe: str) -> list[dict]:
    """
    Flatten study plots into a list of dicts keyed by timestamp.
    Each row: {symbol, timeframe, ts, <plot_name>: value, ...}
    """
    plots = study_result.get("plots", [])
    if not plots:
        return []

    # Build ts → row map
    rows: dict[int, dict] = {}
    for plot in plots:
        name = plot.get("name") or plot.get("id") or "value"
        for point in plot.get("data", []):
            ts = point["ts"]
            if ts not in rows:
                rows[ts] = {"symbol": symbol, "timeframe": timeframe, "ts": ts}
            rows[ts][name] = point["value"]

    return sorted(rows.values(), key=lambda r: r["ts"])


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def load_cfg() -> dict:
    url = os.environ.get("WORKER_URL", "").rstrip("/")
    secret = os.environ.get("HMAC_SECRET", "")
    client_id = os.environ.get("HMAC_CLIENT_ID", "ml-pipeline")
    if not url or not secret:
        sys.exit(
            "Set WORKER_URL and HMAC_SECRET environment variables.\n"
            "Optional: HMAC_CLIENT_ID (default: ml-pipeline)"
        )
    return {"worker_url": url, "secret": secret, "client_id": client_id}


def cmd_search(args, cfg: dict) -> None:
    print(f"Searching for: {args.search!r}")
    results = search_indicator(args.search, cfg)
    if not results:
        print("No results found.")
        return
    print(f"Found {len(results)} result(s):\n")
    for r in results[:20]:
        print(f"  id={r.get('id')!r}  name={r.get('name')!r}  kind={r.get('kind')}")
    if len(results) > 20:
        print(f"  ... and {len(results) - 20} more (narrow your search)")


def cmd_meta(args, cfg: dict) -> None:
    print(f"Fetching metadata for: {args.indicator!r}")
    meta = get_indicator_meta(args.indicator, cfg)
    print(f"\nName: {meta.get('metaInfo', {}).get('description') or meta.get('description')}")
    print(f"Version: {meta.get('version')}")
    print(f"\nInputs ({len(meta.get('inputs', []))}):")
    for inp in meta.get("inputs", []):
        print(f"  {inp.get('id'):30s}  type={inp.get('type')}  default={inp.get('defval')}")
    print(f"\nPlots ({len(meta.get('plots', []))}):")
    for p in meta.get("plots", []):
        if p.get("type") != "no_series":
            print(f"  {p.get('id'):30s}  title={p.get('title')}  type={p.get('type')}")


def cmd_download(args, cfg: dict) -> None:
    symbols: list[str] = args.symbols
    timeframe: str = str(args.timeframe)
    bars: int = min(args.bars, 20000)
    indicator_id: str = args.indicator

    # Parse optional inputs JSON
    inputs: dict | None = None
    if args.inputs:
        try:
            inputs = json.loads(args.inputs)
        except json.JSONDecodeError as e:
            sys.exit(f"--inputs is not valid JSON: {e}")

    all_rows: list[dict] = []
    fieldnames: list[str] = []

    for symbol in symbols:
        print(f"  Running study: {symbol}  tf={timeframe}  bars={bars}", flush=True)
        try:
            result = run_study(symbol, indicator_id, timeframe, bars, inputs, cfg)
        except RuntimeError as e:
            print(f"  ERROR {symbol}: {e}", file=sys.stderr)
            continue

        rows = extract_rows(result, symbol, timeframe)
        if not rows:
            print(f"  WARNING: no data returned for {symbol}", file=sys.stderr)
            continue

        # Track union of field names across all symbols
        for row in rows:
            for k in row:
                if k not in fieldnames:
                    fieldnames.append(k)

        all_rows.extend(rows)
        print(f"  {len(rows)} bars collected for {symbol}")

    if not all_rows:
        print("No data collected. Check indicator ID and that stored session has access.")
        return

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    # Ensure consistent column order: symbol, timeframe, ts, then signal columns
    core = ["symbol", "timeframe", "ts"]
    signal_cols = [f for f in fieldnames if f not in core]
    ordered = core + sorted(signal_cols)

    fmt = getattr(args, "format", "csv")
    if fmt in ("parquet", "both"):
        pq_path = out_path.with_suffix(".parquet")
        _save_parquet(all_rows, pq_path)
        print(f"Saved {len(all_rows)} rows → {pq_path}")
    if fmt in ("csv", "both") or fmt == "csv":
        with open(out_path, "w", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=ordered, extrasaction="ignore")
            writer.writeheader()
            writer.writerows(all_rows)
        print(f"Saved {len(all_rows)} rows → {out_path}")
    print(f"Columns: {ordered}")


# ---------------------------------------------------------------------------
# Feature engineering
# ---------------------------------------------------------------------------

def engineer_features(rows: list[dict]) -> list[dict]:
    """Add derived features to signal rows: returns, normalized values, signal flags."""
    if not rows:
        return rows

    # Sort by timestamp
    rows.sort(key=lambda r: r["ts"])
    signal_cols = [k for k in rows[0] if k not in ("symbol", "timeframe", "ts")]

    # Compute returns from any plot that looks like a price series (large absolute values)
    for col in signal_cols:
        values = [r.get(col) for r in rows]
        if not all(isinstance(v, (int, float)) for v in values):
            continue

        # Only compute returns for numeric series with enough variance
        numeric = [v for v in values if v is not None and v != 0]
        if not numeric:
            continue

        # Simple pct change
        for i in range(1, len(rows)):
            prev = rows[i - 1].get(col)
            curr = rows[i].get(col)
            if prev and curr and prev != 0:
                rows[i][f"{col}_pct"] = (curr - prev) / abs(prev)
            else:
                rows[i][f"{col}_pct"] = None

    # Add timestamp-derived features
    for row in rows:
        ts = row.get("ts", 0)
        if ts:
            import datetime
            dt = datetime.datetime.fromtimestamp(ts, tz=datetime.timezone.utc)
            row["hour"] = dt.hour
            row["day_of_week"] = dt.weekday()

    return rows


# ---------------------------------------------------------------------------
# Parquet output
# ---------------------------------------------------------------------------

def _save_parquet(rows: list[dict], path: Path) -> None:
    """Save rows to parquet with proper type inference."""
    try:
        import pyarrow as pa
        import pyarrow.parquet as pq
    except ImportError:
        try:
            import polars as pl

            df = pl.DataFrame(rows)
            df.write_parquet(str(path))
            return
        except ImportError:
            print("WARNING: Install pyarrow or polars for parquet output: pip install pyarrow", file=sys.stderr)
            return

    fieldnames = list(rows[0].keys())
    columns: dict[str, list] = {k: [r.get(k) for r in rows] for k in fieldnames}

    # Numeric conversion per column
    for k in fieldnames:
        vals = columns[k]
        try:
            columns[k] = [None if v == "" else float(v) for v in vals]
        except (ValueError, TypeError):
            columns[k] = vals

    arrays = [pa.array(columns[k]) for k in fieldnames]
    table = pa.table(dict(zip(fieldnames, arrays)))
    pq.write_table(table, str(path))


# ---------------------------------------------------------------------------
# Collect command — batch ML data collection
# ---------------------------------------------------------------------------

def _load_collect_config(path: str) -> dict:
    """Load collect config from YAML or JSON."""
    text = Path(path).read_text()
    if path.endswith((".yaml", ".yml")):
        try:
            import yaml
            return yaml.safe_load(text)
        except ImportError:
            # Minimal YAML parser for the subset we use
            import json
            # Fallback: try to parse as JSON
            return json.loads(text)
    return json.loads(text)


def cmd_collect(args, cfg: dict) -> None:
    """Batch collect indicator signals for ML training."""
    config = _load_collect_config(args.config)

    symbols = config["symbols"]
    timeframes = config["timeframes"]
    bars = config.get("bars", 5000)
    indicators = config["indicators"]
    output_dir = Path(config.get("output_dir", "ml/data"))
    delay = config.get("delay_seconds", 1.5)
    fmt = config.get("format", "both")

    # Calculate total tasks
    total = len(indicators) * len(symbols) * len(timeframes)
    print(f"Collection plan:")
    print(f"  Indicators:  {len(indicators)}")
    print(f"  Symbols:     {len(symbols)}")
    print(f"  Timeframes:  {len(timeframes)}")
    print(f"  Bars:        {bars}")
    print(f"  Total tasks: {total}")
    print(f"  Output:      {output_dir}")
    print(f"  Format:      {fmt}")
    print()

    if args.dry_run:
        for ind in indicators:
            for symbol in symbols:
                for tf in timeframes:
                    name = ind.get("name", ind["id"].replace(";", "_"))
                    print(f"  {name:40s} {symbol:20s} tf={tf:4s} bars={bars}")
        return

    output_dir.mkdir(parents=True, exist_ok=True)
    done = 0
    errors = 0

    for ind in indicators:
        ind_id = ind["id"]
        ind_name = ind.get("name", ind_id.replace(";", "_"))

        for symbol in symbols:
            for tf in timeframes:
                done += 1
                label = f"[{done}/{total}] {ind_name} {symbol} tf={tf}"
                out_stem = output_dir / f"{ind_name}_{symbol.replace(':', '_')}_{tf}"

                # Skip if output already exists
                if out_stem.with_suffix(".parquet").exists() or out_stem.with_suffix(".csv").exists():
                    print(f"  SKIP (exists) {label}")
                    continue

                print(f"  {label}", flush=True)
                try:
                    result = run_study(symbol, ind_id, tf, bars, None, cfg)
                    rows = extract_rows(result, symbol, tf)
                except RuntimeError as e:
                    print(f"  ERROR: {e}", file=sys.stderr)
                    errors += 1
                    continue

                if not rows:
                    print(f"  WARNING: no data", file=sys.stderr)
                    errors += 1
                    continue

                rows = engineer_features(rows)

                # Determine columns
                core = ["symbol", "timeframe", "ts", "hour", "day_of_week"]
                signal_cols = sorted(k for k in rows[0] if k not in core)
                ordered = core + signal_cols

                if fmt in ("csv", "both"):
                    with open(out_stem.with_suffix(".csv"), "w", newline="") as f:
                        writer = csv.DictWriter(f, fieldnames=ordered, extrasaction="ignore")
                        writer.writeheader()
                        writer.writerows(rows)

                if fmt in ("parquet", "both"):
                    _save_parquet(rows, out_stem.with_suffix(".parquet"))

                print(f"    {len(rows)} rows, {len(signal_cols)} signal columns")

                if done < total:
                    time.sleep(delay)

    print(f"\nCollection complete: {done - errors}/{total} succeeded, {errors} errors")
    print(f"Output directory: {output_dir}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Download TradingView indicator data for ML pipelines."
    )
    sub = parser.add_subparsers(dest="cmd")

    # search sub-command
    s = sub.add_parser("search", help="Search public indicator catalog by name.")
    s.add_argument("search", help='Search query, e.g. "Algorganic"')

    # meta sub-command
    m = sub.add_parser("meta", help="Show indicator metadata and plot names.")
    m.add_argument("indicator", help="Indicator scriptIdPart, e.g. PUB;abc123...")

    # download sub-command
    d = sub.add_parser("download", help="Fetch historical signal data.")
    d.add_argument("--indicator", required=True, help="Indicator scriptIdPart (PUB;...)")
    d.add_argument(
        "--symbols", nargs="+", required=True,
        help='Symbols e.g. BINANCE:BTCUSDT NASDAQ:AAPL'
    )
    d.add_argument("--timeframe", default="60", help="Timeframe: 1 5 15 60 240 D W (default: 60)")
    d.add_argument("--bars", type=int, default=5000, help="Bars per symbol (max 20000, default: 5000)")
    d.add_argument("--out", default="signals.csv", help="Output path (default: signals.csv)")
    d.add_argument("--format", default="parquet", choices=["csv", "parquet", "both"], help="Output format (default: parquet)")
    d.add_argument(
        "--inputs", default=None,
        help='JSON object of indicator inputs to override, e.g. \'{"length": 14}\''
    )

    # collect sub-command — batch ML data collection
    c = sub.add_parser("collect", help="Batch collect signals for ML training.")
    c.add_argument("--config", required=True, help="YAML/JSON config file path")
    c.add_argument("--dry-run", action="store_true", help="Print plan without collecting")

    # Convenience: top-level --search still works (legacy compat)
    parser.add_argument("--search", help="(shorthand) Search indicator catalog")
    parser.add_argument("--indicator", help="(shorthand) Indicator ID for meta")

    args = parser.parse_args()
    cfg = load_cfg()

    if args.cmd == "search" or (not args.cmd and args.search):
        if not args.cmd:
            args.search = args.search
        cmd_search(args, cfg)
    elif args.cmd == "meta" or (not args.cmd and args.indicator and not hasattr(args, "symbols")):
        cmd_meta(args, cfg)
    elif args.cmd == "download":
        cmd_download(args, cfg)
    elif args.cmd == "collect":
        cmd_collect(args, cfg)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
