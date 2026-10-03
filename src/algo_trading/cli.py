"""Command-line entry point: ``algo-trading backtest``."""

from __future__ import annotations

import argparse
import datetime as dt
from collections import Counter
from collections.abc import Sequence
from pathlib import Path

import pandas as pd

from algo_trading import universe
from algo_trading.backtest import BacktestConfig, BacktestResult, run_backtest
from algo_trading.market_data import Bars, CachedMarketData, MarketData, YFinanceMarketData
from algo_trading.metrics import Summary, summarize

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

    def periods(series: pd.Series) -> list[tuple[str, Summary]]:
        return [
            ("full", summarize(series, cash)),
            ("before holdout", summarize(series.loc[:holdout], cash)),
            ("holdout", summarize(series.loc[holdout:], cash)),
        ]

    first, last = eq.index[0].date(), eq.index[-1].date()
    lines = [
        f"Backtest {first} to {last}  ·  cost {result.config.cost_bps:g} bps per dollar traded",
        "",
        f"{'':<10}{'period':<16}{'CAGR':>8}{'vol':>8}{'Sharpe':>8}{'max DD':>9}",
    ]
    for name, series in (("strategy", eq), ("SPY", bench)):
        for period, s in periods(series):
            lines.append(
                f"{name:<10}{period:<16}{s.cagr:>8.1%}{s.volatility:>8.1%}"
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


def main(argv: Sequence[str] | None = None, source: MarketData | None = None) -> int:
    parser = argparse.ArgumentParser(prog="algo-trading")
    commands = parser.add_subparsers(dest="command", required=True)
    bt = commands.add_parser("backtest", help="run the strategy on historical prices")
    bt.add_argument("--cost-bps", type=float, default=5.0, help="cost per dollar traded")
    bt.add_argument("--refresh", action="store_true", help="re-download prices")
    args = parser.parse_args(argv)

    if source is None:
        if args.refresh:
            CACHE_PATH.unlink(missing_ok=True)
        source = CachedMarketData(YFinanceMarketData(), CACHE_PATH)
    bars = load_bars(source)
    result = run_backtest(bars, BacktestConfig(cost_bps=args.cost_bps, start=BACKTEST_START))
    print(format_report(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
