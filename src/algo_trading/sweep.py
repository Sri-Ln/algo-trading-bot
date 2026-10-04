"""Robustness checks: nearby parameter settings, and a range of trading costs.

A result that only holds at the published settings, or only at an optimistic
cost, is more likely fitted to the past than a property of the rules.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, replace
from typing import Any

import pandas as pd

from algo_trading.backtest import BacktestConfig, BacktestResult, run_backtest, with_cost
from algo_trading.market_data import Bars
from algo_trading.metrics import TRADING_DAYS, Summary, summarize_split

BOND_LOOKBACKS = (40, 50, 60, 70, 80)
RISK_ON_RSI_WINDOWS = (6, 8, 10, 12, 14)
COSTS_BPS = tuple(float(c) for c in range(26))


@dataclass(frozen=True)
class SweepCell:
    bond_lookback: int
    risk_on_rsi_window: int
    periods: dict[str, Summary]
    trades_per_year: float

    def to_dict(self) -> dict[str, Any]:
        return {
            "bond_lookback": self.bond_lookback,
            "risk_on_rsi_window": self.risk_on_rsi_window,
            "periods": {name: s.to_dict() for name, s in self.periods.items()},
            "trades_per_year": self.trades_per_year,
        }


@dataclass(frozen=True)
class CostPoint:
    cost_bps: float
    periods: dict[str, Summary]
    cost_drag: float  # fraction of portfolio value paid in costs per year

    def to_dict(self) -> dict[str, Any]:
        return {
            "cost_bps": self.cost_bps,
            "periods": {name: s.to_dict() for name, s in self.periods.items()},
            "cost_drag": self.cost_drag,
        }


def parameter_sweep(
    bars: Bars,
    config: BacktestConfig,
    holdout: pd.Timestamp,
    bond_lookbacks: Sequence[int] = BOND_LOOKBACKS,
    risk_on_rsi_windows: Sequence[int] = RISK_ON_RSI_WINDOWS,
) -> list[SweepCell]:
    """Backtest every combination of bond lookback and risk-on RSI window.

    Everything else in ``config`` stays fixed. Cells are ordered by bond
    lookback, then RSI window.
    """
    cells = []
    for lookback in bond_lookbacks:
        for window in risk_on_rsi_windows:
            params = replace(config.params, bond_lookback=lookback, risk_on_rsi_window=window)
            result = run_backtest(bars, replace(config, params=params))
            cells.append(
                SweepCell(
                    lookback,
                    window,
                    summarize_split(result.equity, result.cash_returns, holdout),
                    len(result.trades) / _years(result),
                )
            )
    return cells


def cost_sensitivity(
    result: BacktestResult, holdout: pd.Timestamp, costs_bps: Sequence[float] = COSTS_BPS
) -> list[CostPoint]:
    """Statistics for ``result`` re-priced at each trading cost."""
    points = []
    for cost in costs_bps:
        priced = with_cost(result, cost)
        points.append(
            CostPoint(
                cost,
                summarize_split(priced.equity, priced.cash_returns, holdout),
                sum(t.cost for t in priced.trades) / _years(priced),
            )
        )
    return points


def _years(result: BacktestResult) -> float:
    return (len(result.equity) - 1) / TRADING_DAYS
