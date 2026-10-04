"""Command-line entry point: ``algo-trading backtest``, ``sweep``, ``live``, ``export``."""

from __future__ import annotations

import argparse
import datetime as dt
from collections import Counter
from collections.abc import Sequence
from pathlib import Path

import pandas as pd

from algo_trading import universe
from algo_trading.alpaca import AlpacaBroker
from algo_trading.api import create_app
from algo_trading.backtest import BacktestConfig, BacktestResult, run_backtest
from algo_trading.broker import Broker
from algo_trading.console import ConsoleData, build_console_data
from algo_trading.export import export_static, read_checks, write_openapi
from algo_trading.live import LiveConfig, run_live
from algo_trading.market_data import Bars, CachedMarketData, MarketData, YFinanceMarketData
from algo_trading.metrics import summarize, summarize_split
from algo_trading.store import BACKTEST_DIR, LIVE_DIR, load_runs, save_json, save_run
from algo_trading.strategy import Params
from algo_trading.sweep import (
    BOND_LOOKBACKS,
    RISK_ON_RSI_WINDOWS,
    CostPoint,
    SweepCell,
    cost_sensitivity,
    parameter_sweep,
)

# First download date: enough history before the backtest start to warm up the
# 250-day RSI window. BTAL, the youngest fund, launched in September 2011.
DATA_START = dt.date(2011, 10, 3)
BACKTEST_START = pd.Timestamp("2013-01-02")
# Fixed before looking at any results; later years are the out-of-sample test.
HOLDOUT_START = pd.Timestamp("2023-01-03")
CACHE_PATH = Path("data/cache/bars.parquet")


def load_bars(source: MarketData, end: dt.date | None = None) -> Bars:
    return source.get_bars(universe.ALL_TICKERS, DATA_START, end or dt.date.today())


def format_report(result: BacktestResult, holdout: pd.Timestamp = HOLDOUT_START) -> str:
    eq, bench, cash = result.equity, result.benchmark, result.cash_returns

    first, last = eq.index[0].date(), eq.index[-1].date()
    lines = [
        f"Backtest {first} to {last}  ·  cost {result.config.cost_bps:g} bps per dollar traded",
        "",
        f"{'':<10}{'period':<16}{'CAGR':>8}{'vol':>8}{'Sharpe':>8}{'max DD':>9}",
    ]
    for name, series in (("strategy", eq), ("SPY", bench)):
        for period, s in summarize_split(series, cash, holdout).items():
            lines.append(
                f"{name:<10}{period.replace('_', ' '):<16}{s.cagr:>8.1%}{s.volatility:>8.1%}"
                f"{s.sharpe:>8.2f}{s.max_drawdown:>9.1%}"
            )
            name = ""
    years = summarize(eq).years
    share = Counter(result.regimes)
    total = sum(share.values())
    lines += [
        "",
        f"trades per year   {len(result.trades) / years:.1f}",
        f"cost drag         {sum(t.cost for t in result.trades) / years:.2%} per year",
        "time in regime    "
        + "  ".join(f"{regime} {count / total:.0%}" for regime, count in share.most_common()),
    ]
    return "\n".join(lines)


def format_sweep(cells: Sequence[SweepCell], baseline: Params) -> str:
    """Sharpe ratio grids before and during the holdout; ``*`` marks the published settings."""
    lookbacks = sorted({c.bond_lookback for c in cells})
    windows = sorted({c.risk_on_rsi_window for c in cells})
    grid = {(c.bond_lookback, c.risk_on_rsi_window): c for c in cells}
    published = (baseline.bond_lookback, baseline.risk_on_rsi_window)
    lines = []
    for period in ("before_holdout", "holdout"):
        lines += [
            f"Sharpe {period.replace('_', ' ')}: bond lookback (rows) x risk-on RSI window",
            f"{'':>6}" + "".join(f"{w:>8}" for w in windows),
        ]
        for lookback in lookbacks:
            row = f"{lookback:>6}"
            for w in windows:
                mark = "*" if (lookback, w) == published else " "
                row += f"{grid[lookback, w].periods[period].sharpe:>7.2f}{mark}"
            lines.append(row.rstrip())
        lines.append("")
    return "\n".join(lines).rstrip()


def format_costs(points: Sequence[CostPoint], every_bps: float = 5.0) -> str:
    lines = [f"{'cost':>6}{'CAGR':>8}{'Sharpe':>8}{'holdout':>9}{'drag/yr':>9}"]
    for p in points:
        if p.cost_bps % every_bps == 0:
            full = p.periods["full"]
            lines.append(
                f"{p.cost_bps:>4g}bp{full.cagr:>8.1%}{full.sharpe:>8.2f}"
                f"{p.periods['holdout'].sharpe:>9.2f}{p.cost_drag:>9.2%}"
            )
    return "\n".join(lines)


def main(
    argv: Sequence[str] | None = None,
    source: MarketData | None = None,
    broker: Broker | None = None,
    live_dir: Path = LIVE_DIR,
    backtest_dir: Path = BACKTEST_DIR,
) -> int:
    parser = argparse.ArgumentParser(prog="algo-trading")
    commands = parser.add_subparsers(dest="command", required=True)
    bt = commands.add_parser("backtest", help="run the strategy on historical prices")
    bt.add_argument("--cost-bps", type=float, default=5.0, help="cost per dollar traded")
    sweep = commands.add_parser(
        "sweep", help="re-run the backtest with nearby settings and costs; save the results"
    )
    sweep.add_argument("--cost-bps", type=float, default=5.0, help="cost for the settings sweep")
    for cmd in (bt, sweep):
        cmd.add_argument("--refresh", action="store_true", help="re-download prices")
    live = commands.add_parser("live", help="run today's decision against the paper account")
    live.add_argument("--dry-run", action="store_true", help="plan orders but do not send them")
    export = commands.add_parser("export", help="write the console API as static JSON files")
    export.add_argument("--out", type=Path, default=Path("site"), help="output directory")
    export.add_argument("--commit", help="commit being published, shown in the console")
    export.add_argument("--junit", type=Path, help="pytest JUnit XML report to publish")
    export.add_argument("--coverage", type=Path, help="coverage.py JSON report to publish")
    export.add_argument("--refresh", action="store_true", help="re-download prices")
    export.add_argument("--cost-bps", type=float, default=5.0, help="cost per dollar traded")
    openapi = commands.add_parser("openapi", help="write the console API's OpenAPI schema")
    openapi.add_argument("out", type=Path, help="schema file to write")
    args = parser.parse_args(argv)

    if args.command == "live":
        return _live(source, broker, live_dir, dry_run=args.dry_run)
    if args.command == "openapi":
        print(f"saved {write_openapi(create_app(_no_data), args.out)}")
        return 0

    if source is None:
        if args.refresh:
            CACHE_PATH.unlink(missing_ok=True)
        source = CachedMarketData(YFinanceMarketData(), CACHE_PATH)
    bars = load_bars(source)
    config = BacktestConfig(cost_bps=args.cost_bps, start=BACKTEST_START)
    if args.command == "sweep":
        return _sweep(bars, config, backtest_dir)
    if args.command == "export":
        checks = read_checks(args.junit, args.coverage) if args.junit else None
        data = build_console_data(
            bars,
            config,
            HOLDOUT_START,
            load_runs(live_dir),
            built_at=dt.datetime.now(dt.UTC).isoformat(timespec="seconds"),
            commit=args.commit,
            checks=checks,
            bond_lookbacks=BOND_LOOKBACKS,
            risk_on_rsi_windows=RISK_ON_RSI_WINDOWS,
        )
        written = export_static(create_app(lambda: data), data, args.out)
        print(f"wrote {len(written)} files to {args.out}")
        return 0
    print(format_report(run_backtest(bars, config)))
    return 0


def _sweep(bars: Bars, config: BacktestConfig, out: Path) -> int:
    result = run_backtest(bars, config)
    cells = parameter_sweep(bars, config, HOLDOUT_START, BOND_LOOKBACKS, RISK_ON_RSI_WINDOWS)
    points = cost_sensitivity(result, HOLDOUT_START)
    span = {
        "start": result.equity.index[0].date().isoformat(),
        "end": result.equity.index[-1].date().isoformat(),
        "holdout_start": HOLDOUT_START.date().isoformat(),
    }
    baseline = config.params
    sweep_path = save_json(
        {
            **span,
            "cost_bps": config.cost_bps,
            "baseline": {
                "bond_lookback": baseline.bond_lookback,
                "risk_on_rsi_window": baseline.risk_on_rsi_window,
            },
            "bond_lookbacks": sorted({c.bond_lookback for c in cells}),
            "risk_on_rsi_windows": sorted({c.risk_on_rsi_window for c in cells}),
            "cells": [c.to_dict() for c in cells],
        },
        out / "sweep.json",
    )
    costs_path = save_json(
        {**span, "baseline_cost_bps": config.cost_bps, "points": [p.to_dict() for p in points]},
        out / "costs.json",
    )
    print(f"Sweep {span['start']} to {span['end']}  ·  cost {config.cost_bps:g} bps\n")
    print(format_sweep(cells, baseline))
    print("\nTrading cost sensitivity (published settings)")
    print(format_costs(points))
    print(f"\nsaved {sweep_path} and {costs_path}")
    return 0


def _no_data() -> ConsoleData:
    raise RuntimeError("the schema needs no data")


def _live(source: MarketData | None, broker: Broker | None, live_dir: Path, dry_run: bool) -> int:
    # Live runs always download fresh prices; a cache could hold yesterday's data.
    record = run_live(
        source or YFinanceMarketData(),
        broker or AlpacaBroker.from_env(),
        dt.datetime.now(dt.UTC),
        LiveConfig(dry_run=dry_run),
    )
    path = save_run(record, live_dir)
    print(f"{record.trading_day}: {record.status}" + (f" ({record.error})" if record.error else ""))
    for step in record.steps:
        print(f"  {step.name:<14}{step.status:<9}{step.ms:>8.0f} ms  {step.detail}")
    print(f"saved {path}")
    return 1 if record.status == "failed" else 0


if __name__ == "__main__":
    raise SystemExit(main())
