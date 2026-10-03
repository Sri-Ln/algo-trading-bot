"""The trading rules, as one pure function from closing prices to a decision.

Rules, checked in order (the first that holds decides):

1. Bonds (AGG) beat cash (BIL) over ``bond_lookback`` days -> risk on: split
   evenly between the ``risk_on_picks`` leveraged equity funds with the lowest RSI.
2. Long bonds (TLT) trail cash over ``long_bond_lookback`` days -> risk off,
   rising rates: half the dollar fund, half the lower-RSI short fund.
3. Otherwise -> risk off, falling rates: equal-weight defensive basket.

The decision carries the inputs behind it, so callers can show *why* as well
as *what*. The same function serves the backtest and the live bot.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any

import pandas as pd

from algo_trading import universe
from algo_trading.indicators import RsiMethod, cumulative_return, rsi


class Regime(StrEnum):
    RISK_ON = "risk_on"
    RISK_OFF_RISING = "risk_off_rising"
    RISK_OFF_FALLING = "risk_off_falling"


@dataclass(frozen=True)
class Params:
    bond_lookback: int = 60
    long_bond_lookback: int = 20
    risk_on_rsi_window: int = 10
    rising_rates_rsi_window: int = 20
    risk_on_picks: int = 2
    rsi_method: RsiMethod = "wilder"
    # Wilder RSI depends on how much history it sees, so it is always computed
    # over exactly this many bars to give the same value in backtest and live.
    rsi_history: int = 250

    @property
    def bars_needed(self) -> int:
        return max(self.bond_lookback, self.long_bond_lookback, self.rsi_history) + 1


@dataclass(frozen=True)
class Check:
    """One rule comparison: did ``left`` beat (or trail) ``right`` over ``lookback`` days."""

    rule: int
    left: str
    right: str
    lookback: int
    left_return: float
    right_return: float
    passed: bool

    @property
    def gap(self) -> float:
        return self.left_return - self.right_return


@dataclass(frozen=True)
class Decision:
    date: pd.Timestamp
    regime: Regime
    checks: tuple[Check, ...]
    weights: dict[str, float]
    # RSI of each candidate fund considered, lowest first.
    rsi: dict[str, float] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "date": self.date.date().isoformat(),
            "regime": self.regime.value,
            "checks": [
                {
                    "rule": c.rule,
                    "left": c.left,
                    "right": c.right,
                    "lookback": c.lookback,
                    "left_return": c.left_return,
                    "right_return": c.right_return,
                    "gap": c.gap,
                    "passed": c.passed,
                }
                for c in self.checks
            ],
            "rsi": self.rsi,
            "weights": self.weights,
        }


def strategy(closes: pd.DataFrame, params: Params | None = None) -> Decision:
    """Decide target weights from closing prices, using the last row as today."""
    params = params or Params()
    if len(closes) < params.bars_needed:
        raise ValueError(f"need {params.bars_needed} days of prices, got {len(closes)}")
    window = closes.iloc[-params.bars_needed :]
    today = pd.Timestamp(window.index[-1])

    def ret(ticker: str, days: int) -> float:
        return cumulative_return(window[ticker], days)

    def ranked(tickers: tuple[str, ...], rsi_window: int) -> dict[str, float]:
        history = window.iloc[-(params.rsi_history + 1) :]
        scores = {t: rsi(history[t], rsi_window, params.rsi_method) for t in tickers}
        return dict(sorted(scores.items(), key=lambda kv: (kv[1], kv[0])))

    lookback = params.bond_lookback
    bonds, cash = ret(universe.BONDS, lookback), ret(universe.CASH, lookback)
    rule_1 = Check(1, universe.BONDS, universe.CASH, lookback, bonds, cash, bonds > cash)
    if rule_1.passed:
        scores = ranked(universe.RISK_ON, params.risk_on_rsi_window)
        picks = list(scores)[: params.risk_on_picks]
        weights = {t: 1.0 / len(picks) for t in picks}
        return Decision(today, Regime.RISK_ON, (rule_1,), weights, scores)

    long_bonds = ret(universe.LONG_BONDS, params.long_bond_lookback)
    cash_short = ret(universe.CASH, params.long_bond_lookback)
    rule_2 = Check(
        2,
        universe.LONG_BONDS,
        universe.CASH,
        params.long_bond_lookback,
        long_bonds,
        cash_short,
        long_bonds < cash_short,
    )
    if rule_2.passed:
        scores = ranked(universe.RISING_RATES_HEDGES, params.rising_rates_rsi_window)
        hedge = next(iter(scores))
        weights = {universe.DOLLAR: 0.5, hedge: 0.5}
        return Decision(today, Regime.RISK_OFF_RISING, (rule_1, rule_2), weights, scores)

    basket = universe.FALLING_RATES_BASKET
    weights = {t: 1.0 / len(basket) for t in basket}
    return Decision(today, Regime.RISK_OFF_FALLING, (rule_1, rule_2), weights)
