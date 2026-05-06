# Strategies reference

Strategies share the study slot. There are no dedicated strategy verbs (`strategy_create_session`, `report_data`, `trades_data`, `equity_curve` do not exist). The full backtest report is computed client-side from `du` plot output of the strategy study.

## Detection

A study is a strategy if any of the following match (verified in bundles `14151`, `55548`):

- `metaInfo.is_strategy === true`
- `extra.kind === "strategy"` on the catalog list response
- `Script$<id>@tv-scripting-101!` plus `pineId` referencing a published strategy

`isStudyStrategy(study)` and `isStudyStrategyStub(study)` are the canonical helpers in `packages/tradingview-core/src/strategy.ts`.

## Property fields (16, verbatim)

These are the strategy-specific inputs that drive the simulator. Sent in `in_0` of the `create_study` inputs alongside user inputs:

```
initial_capital
currency
default_qty_value
default_qty_type        ∈ {"fixed", "cash_per_order", "percent_of_equity"}
pyramiding
commission_value
commission_type         ∈ {"percent", "cash_per_contract", "cash_per_order"}
backtest_fill_limits_assumption
slippage
calc_on_order_fills
calc_on_every_tick
margin_long
margin_short
use_bar_magnifier
process_orders_on_close
fill_orders_on_standard_ohlc
```

`max_bars_back` lives in user inputs (`internalID === "calc_bars_count" | "max_bars_back"`), not properties.

## Report fields (27, snake_case literals confirmed)

Computed client-side from `du.params[1].<slot>.ns` non-series outputs:

```
gross_profit, net_profit, profit_factor
max_drawdown, max_drawdown_percent
max_runup, max_runup_percent
max_intraday_loss
max_cons_loss_days
currency_rate
sharpe_ratio, sortino_ratio
total_trades, winning_trades, losing_trades, even_trades
win_rate
avg_trade, avg_winning_trade, avg_losing_trade
largest_winning_trade, largest_losing_trade
buy_hold_return, alpha, beta
ratio_avg_win_avg_loss
```

Field names are display-side, not wire-level. The Worker computes them from `du.ns` arrays before returning.

## Trade list (per `du.st[]` row)

```
bar_index, time, signal, qty, price, profit, profit_pct, cumulative_profit,
type ∈ {"buy", "sell", "long", "short"}, comment, drawdown, runup
```

Each row corresponds to one entry/exit fill.

## Equity series

`du.params[1].<slot>.ns` carries arrays:

```
equity[]              — equity curve
drawdown[]            — running drawdown
runup[]               — running runup
buy_hold_equity[]     — benchmark
```

Aligned to the bar timestamp via the corresponding `du.st[].i` index.

## WS sequence (verified)

```
> set_auth_token <jwt>
> chart_create_session [cs1, ""]
> resolve_symbol [cs1, sds_sym_1, "=" + JSON]
> create_series [cs1, sds_1, s1, sds_sym_1, tf, bars, ""]
> create_study [cs1, st1, "", sds_1, "Script$<id>@tv-scripting-101!",
                {"text": "<pine source>", "pineId": "...", "pineVersion": "...",
                 "in_0": {<properties + user inputs>},
                 "in_1": <…>, …}]
< study_loading [st1]
< du [cs1, {st1: {t: "", st: [<trade rows>], ns: {<equity arrays>}}}]
< study_completed [st1, ""]
> chart_delete_session [cs1]
```

For built-in strategies (`STD;Supertrend Strategy`), the indicator id is `Script$STD;Supertrend Strategy@tv-scripting-101!` and `text`/`pineId` are omitted; properties go in `in_0` together with user inputs.

## Closed-source backtest

Run a closed-source strategy without source download via:

1. `GET /pine-facade/is_auth_to_get/{scriptId}/{version}` — returns truthy if the user has read access (paid invite, owner, public).
2. **If truthy**: send `create_study` with `Script$<scriptId>@tv-scripting-101!` and the metainfo's `pineId`/`pineVersion` only — TV server resolves source server-side.
3. **If falsy**: fall back to plot-echo via a thin receiver Pine strategy that subscribes to the closed-source plot output as a `source` input. Limited to plots the closed-source script publicly exposes.

## Deep history controls

Controlled by series, not strategy:

- `set_data_quality(["low"])` — only documented degradation knob; trades quality for depth.
- Bar count via the `bars` arg on `create_series` plus repeated `request_more_data`.
- There is no `deep_history` literal anywhere in TV's surface.

For a 5-year backtest at 1D you typically need `bars: 1300` plus 0–1 `request_more_data` calls. For 1H over 1 year, `bars: 6000` with `request_more_data` likely. Plan-gated.

## Worker route mapping

| Worker route | Composes |
| --- | --- |
| `POST /v1/strategy/run` | resolve_symbol → create_series → create_study with strategy id → accumulate `du` → compute report client-side → return `{report, trades, equity}` |
| `POST /v1/strategy/replay` | Same opening; SSE-stream each `du` frame to the caller as `event:bar` |
| `POST /v1/strategy/optimize` | Fan out to `/v1/strategy/run` for each parameter combo; aggregate by `objective` (`sharpe`, `net_profit`, `win_rate`, custom expression) |

## Body shape for `/v1/strategy/run`

```json
{
  "symbol": "NASDAQ:AAPL",
  "timeframe": "1D",
  "bars": 2000,
  "scriptId": "STD;Supertrend Strategy",          // OR
  "source": "//@version=5\nstrategy(...)\n...",   // OR
  "pineId": "PUB;abc...", "pineVersion": 12,      // closed-source reference
  "properties": {
    "initial_capital": 100000,
    "default_qty_type": "percent_of_equity",
    "default_qty_value": 10,
    "commission_type": "percent",
    "commission_value": 0.1,
    "slippage": 0
  },
  "inputs": { "in_0": 3, "in_1": 10 },
  "params": { "ATR Length": 10 }                  // alternative to in_*; metainfo-mapped
}
```

Returns:

```json
{
  "report": { "net_profit": 12345.67, "profit_factor": 1.4, "max_drawdown": 6789.01, ... },
  "trades": [ { "bar_index": 42, "time": 1700..., "type": "buy", "qty": 100, "price": 150.5, "profit": 0, ... }, ... ],
  "equity": { "equity": [...], "drawdown": [...], "runup": [...], "buy_hold_equity": [...] },
  "diagnostics": { "barsRequested": 2000, "barsReceived": 1987, "studyId": "...", "version": 12 }
}
```

## What does NOT exist

- No `report_data` server frame. The report is reconstructed client-side from `du.ns`.
- No optimization verb. `/v1/strategy/optimize` is a Worker fanout.
- No multi-strategy run on one chart session today (would need P9 stateful chart-session DO).
- No live forward-test mode; TradingView strategies always replay history.
