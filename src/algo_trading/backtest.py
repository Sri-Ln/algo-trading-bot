"""Daily simulation of the strategy on historical bars.

Timing matches what the live bot can do: the decision uses prices up to day
t's close, and trades fill at day t+1's open. Each day therefore has two legs:
overnight (close to open) on yesterday's holdings, then intraday (open to
close) on the holdings after any trades.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field, replace

import pandas as pd

from algo_trading import universe
from algo_trading.market_data import Bars
from algo_trading.strategy import Decision, Params, strategy

Weights = dict[str, float]
DecideFn = Callable[[pd.DataFrame, Params], Decision]


@dataclass(frozen=True)
class BacktestConfig:
    params: Params = field(default_factory=Params)
    # Cost of trading, per dollar bought or sold (spread plus slippage).
    cost_bps: float = 5.0
    # Trade only when target and holdings differ by more than this, summed
    # over all funds; avoids paying costs to chase tiny drifts.
    rebalance_threshold: float = 0.02
    start: pd.Timestamp | None = None
    end: pd.Timestamp | None = None


@dataclass(frozen=True)
class Trade:
    date: pd.Timestamp  # day the orders fill, at the open
    before: Weights
    after: Weights
    turnover: float  # sum of |weight change|: 2.0 means a full switch
    cost: float  # fraction of portfolio value paid


@dataclass(frozen=True)
class BacktestResult:
    config: BacktestConfig
    equity: pd.Series  # portfolio value at each close, 1.0 on the start date
    benchmark: pd.Series  # SPY bought and held from the start date
    cash_returns: pd.Series  # daily BIL return, the risk-free rate for Sharpe
    decisions: list[Decision]
    trades: list[Trade]

    @property
    def regimes(self) -> pd.Series:
        return pd.Series(
            [d.regime.value for d in self.decisions],
            index=pd.DatetimeIndex([d.date for d in self.decisions]),
        )


def run_backtest(
    bars: Bars, config: BacktestConfig | None = None, decide: DecideFn = strategy
) -> BacktestResult:
    """Simulate trading ``decide`` (the real strategy unless a test swaps it) on ``bars``."""
    config = config or BacktestConfig()
    needed = config.params.bars_needed
    dates = bars.dates
    first = max(needed - 1, _index_on_or_after(dates, config.start) if config.start else 0)
    last = _index_on_or_before(dates, config.end) if config.end else len(dates) - 1
    if first >= last:
        raise ValueError("not enough history before the start date to run the strategy")

    opens, closes = bars.open, bars.close
    value = 1.0
    held: Weights = {}
    target: Weights = {}
    equity, decisions, trades = [1.0], [], []

    for i in range(first, last + 1):
        if i > first:
            prev_close, today_open, today_close = closes.iloc[i - 1], opens.iloc[i], closes.iloc[i]
            value, held = _grow(value, held, today_open / prev_close)
            turnover = _turnover(held, target)
            if turnover > config.rebalance_threshold:
                cost = turnover * config.cost_bps / 10_000
                trades.append(Trade(dates[i], held, dict(target), turnover, cost))
                value *= 1.0 - cost
                held = dict(target)
            value, held = _grow(value, held, today_close / today_open)
            equity.append(value)

        decision = decide(closes.iloc[i - needed + 1 : i + 1], config.params)
        decisions.append(decision)
        target = decision.weights

    span = dates[first : last + 1]
    bench = closes[universe.BENCHMARK].iloc[first : last + 1]
    cash = closes[universe.CASH].iloc[first : last + 1].pct_change().fillna(0.0)
    return BacktestResult(
        config=config,
        equity=pd.Series(equity, index=span, name="strategy"),
        benchmark=(bench / bench.iloc[0]).rename("benchmark"),
        cash_returns=cash.rename("cash"),
        decisions=decisions,
        trades=trades,
    )


def _grow(value: float, held: Weights, growth: pd.Series) -> tuple[float, Weights]:
    """Apply one period's price change; weights drift with relative performance."""
    if not held:
        return value, held
    grown = {t: w * float(growth[t]) for t, w in held.items()}
    total = sum(grown.values())
    return value * total, {t: g / total for t, g in grown.items()}


def _turnover(held: Weights, target: Weights) -> float:
    return sum(abs(target.get(t, 0.0) - held.get(t, 0.0)) for t in held.keys() | target.keys())


def _index_on_or_after(dates: pd.DatetimeIndex, day: pd.Timestamp) -> int:
    return int(dates.searchsorted(day, side="left"))


def _index_on_or_before(dates: pd.DatetimeIndex, day: pd.Timestamp) -> int:
    return int(dates.searchsorted(day, side="right")) - 1


def with_cost(result: BacktestResult, cost_bps: float) -> BacktestResult:
    """The same backtest at a different trading cost, without re-running it.

    Costs scale the portfolio's value but never its weights, so the decisions
    and trades are identical at every cost; only the equity curve changes.
    """
    old, new = result.config.cost_bps / 10_000, cost_bps / 10_000
    step = pd.Series(
        [(1.0 - t.turnover * new) / (1.0 - t.turnover * old) for t in result.trades],
        index=pd.DatetimeIndex([t.date for t in result.trades]),
        dtype=float,
    )
    factor = step.reindex(result.equity.index, fill_value=1.0).cumprod()
    return replace(
        result,
        config=replace(result.config, cost_bps=cost_bps),
        equity=pd.Series(
            result.equity.to_numpy() * factor.to_numpy(),
            index=result.equity.index,
            name=result.equity.name,
        ),
        trades=[replace(t, cost=t.turnover * new) for t in result.trades],
    )
