"""Everything the web console shows, computed once from prices and saved live runs."""

from __future__ import annotations

import hashlib
import json
import time
from collections.abc import Sequence
from dataclasses import asdict, dataclass
from typing import Any

import pandas as pd

from algo_trading import universe
from algo_trading.backtest import BacktestConfig, BacktestResult, run_backtest
from algo_trading.market_data import Bars
from algo_trading.sweep import (
    BOND_LOOKBACKS,
    RISK_ON_RSI_WINDOWS,
    CostPoint,
    SweepCell,
    cost_sensitivity,
    parameter_sweep,
)


@dataclass(frozen=True)
class ChecksReport:
    """Results of the test suite on the commit being published."""

    passed: int
    failed: int
    coverage: float | None  # percent of lines run by the tests


@dataclass(frozen=True)
class ConsoleData:
    built_at: str
    commit: str | None
    bars: Bars
    holdout: pd.Timestamp
    backtest: BacktestResult
    backtest_seconds: float
    run_id: str
    signal_1: pd.Series  # bonds minus cash return, the input to rule 1
    signal_2: pd.Series  # long bonds minus cash return, the input to rule 2
    sweep: list[SweepCell]
    sweep_seconds: float
    costs: list[CostPoint]
    runs: list[dict[str, Any]]  # saved live run records, oldest first
    checks: ChecksReport | None

    @property
    def years(self) -> list[int]:
        return sorted({d.date.year for d in self.backtest.decisions})

    @property
    def run_days(self) -> list[str]:
        return [r["trading_day"] for r in self.runs]


def build_console_data(
    bars: Bars,
    config: BacktestConfig,
    holdout: pd.Timestamp,
    runs: list[dict[str, Any]],
    built_at: str,
    commit: str | None = None,
    checks: ChecksReport | None = None,
    bond_lookbacks: Sequence[int] = BOND_LOOKBACKS,
    risk_on_rsi_windows: Sequence[int] = RISK_ON_RSI_WINDOWS,
) -> ConsoleData:
    started = time.perf_counter()
    result = run_backtest(bars, config)
    backtest_seconds = time.perf_counter() - started
    started = time.perf_counter()
    cells = parameter_sweep(bars, config, holdout, bond_lookbacks, risk_on_rsi_windows)
    sweep_seconds = time.perf_counter() - started

    p = config.params
    days = result.equity.index
    return ConsoleData(
        built_at=built_at,
        commit=commit,
        bars=bars,
        holdout=holdout,
        backtest=result,
        backtest_seconds=backtest_seconds,
        run_id=run_id(bars, config),
        signal_1=_gap(bars, universe.BONDS, p.bond_lookback).reindex(days),
        signal_2=_gap(bars, universe.LONG_BONDS, p.long_bond_lookback).reindex(days),
        sweep=cells,
        sweep_seconds=sweep_seconds,
        costs=cost_sensitivity(result, holdout),
        runs=sorted(runs, key=lambda r: str(r["trading_day"])),
        checks=checks,
    )


def run_id(bars: Bars, config: BacktestConfig) -> str:
    """A short ID that changes whenever the settings or the price data change."""
    settings = json.dumps(asdict(config), sort_keys=True, default=str)
    digest = hashlib.sha256(settings.encode())
    digest.update(bars.close.round(6).to_numpy().tobytes())
    digest.update(str(list(bars.dates.date)).encode())
    return "bt-" + digest.hexdigest()[:8]


def output_hash(result: BacktestResult) -> str:
    """Fingerprint of a backtest's equity curve, to spot any change in results."""
    values = result.equity.round(10).to_numpy().tobytes()
    return hashlib.sha256(values).hexdigest()[:12]


def _gap(bars: Bars, ticker: str, days: int) -> pd.Series:
    """Return of ``ticker`` minus the cash fund's, over the trailing ``days``."""
    close = bars.close
    returns = close / close.shift(days) - 1.0
    return returns[ticker] - returns[universe.CASH]
