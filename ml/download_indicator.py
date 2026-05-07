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

    with open(out_path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=ordered, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(all_rows)

    print(f"\nSaved {len(all_rows)} rows → {out_path}")
    print(f"Columns: {ordered}")


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
    d.add_argument("--bars", type=int, default=5000, help="Bars per symbol (max 20000, default 5000)")
    d.add_argument("--out", default="signals.csv", help="Output CSV path (default: signals.csv)")
    d.add_argument(
        "--inputs", default=None,
        help='JSON object of indicator inputs to override, e.g. \'{"length": 14}\''
    )

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
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
