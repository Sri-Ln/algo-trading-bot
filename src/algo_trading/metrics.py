"""Performance statistics for an equity curve."""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass

import pandas as pd

TRADING_DAYS = 252


@dataclass(frozen=True)
class Summary:
    cagr: float  # compound annual growth rate
    volatility: float  # annualized standard deviation of daily returns
    sharpe: float  # annualized mean excess return over cash, per unit of volatility
    max_drawdown: float  # worst peak-to-trough fall, as a negative fraction
    years: float

    def to_dict(self) -> dict[str, float]:
        return asdict(self)


def drawdown(equity: pd.Series) -> pd.Series:
    """Fraction below the running peak on each day (0 at a new high, negative below it)."""
    return equity / equity.cummax() - 1.0


def summarize(equity: pd.Series, cash_returns: pd.Series | None = None) -> Summary:
    """Statistics for ``equity`` (one value per trading day).

    ``cash_returns`` are the daily risk-free returns subtracted for the Sharpe
    ratio; without them Sharpe is measured against zero.
    """
    if len(equity) < 2:
        raise ValueError("need at least two days of equity")
    returns = equity.pct_change().dropna()
    cash = cash_returns.reindex(returns.index).fillna(0.0) if cash_returns is not None else 0.0
    excess = returns - cash

    years = len(returns) / TRADING_DAYS
    growth = float(equity.iloc[-1] / equity.iloc[0])
    std = float(returns.std(ddof=1))
    excess_std = float(excess.std(ddof=1))
    sharpe = float(excess.mean()) / excess_std * math.sqrt(TRADING_DAYS) if excess_std > 0 else 0.0
    return Summary(
        cagr=growth ** (1.0 / years) - 1.0,
        volatility=std * math.sqrt(TRADING_DAYS),
        sharpe=sharpe,
        max_drawdown=float(drawdown(equity).min()),
        years=years,
    )


def summarize_split(
    equity: pd.Series, cash_returns: pd.Series | None, split: pd.Timestamp
) -> dict[str, Summary]:
    """Statistics for the whole curve and for the parts before and after ``split``.

    Both parts include the ``split`` day, so the later part's first return is
    the one from the split day to the next.
    """
    return {
        "full": summarize(equity, cash_returns),
        "before_holdout": summarize(equity.loc[:split], cash_returns),
        "holdout": summarize(equity.loc[split:], cash_returns),
    }
