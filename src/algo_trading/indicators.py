"""Price indicators used by the strategy. Each returns today's value only."""

from typing import Literal

import pandas as pd

RsiMethod = Literal["wilder", "simple"]


def cumulative_return(prices: pd.Series, days: int) -> float:
    """Return over the last ``days`` trading days: today's price vs ``days`` bars ago."""
    if days < 1:
        raise ValueError("days must be at least 1")
    if len(prices) <= days:
        raise ValueError(f"need more than {days} prices, got {len(prices)}")
    return float(prices.iloc[-1] / prices.iloc[-1 - days] - 1.0)


def rsi(prices: pd.Series, window: int, method: RsiMethod = "wilder") -> float:
    """Relative strength index for the last day, from 0 (all losses) to 100 (all gains).

    ``wilder`` is the standard definition: average gains and losses are smoothed
    with factor 1/window, seeded by a simple average of the first ``window``
    changes. It depends on all prices passed in, so callers should pass a fixed
    amount of history for reproducible values. ``simple`` averages only the last
    ``window`` changes.
    """
    if window < 1:
        raise ValueError("window must be at least 1")
    changes = prices.diff().dropna()
    if len(changes) < window:
        raise ValueError(f"need at least {window + 1} prices, got {len(prices)}")
    gains = changes.clip(lower=0.0)
    losses = (-changes).clip(lower=0.0)

    if method == "simple":
        avg_gain = float(gains.iloc[-window:].mean())
        avg_loss = float(losses.iloc[-window:].mean())
    else:
        avg_gain = float(gains.iloc[:window].mean())
        avg_loss = float(losses.iloc[:window].mean())
        for gain, loss in zip(gains.iloc[window:], losses.iloc[window:], strict=True):
            avg_gain = (avg_gain * (window - 1) + float(gain)) / window
            avg_loss = (avg_loss * (window - 1) + float(loss)) / window

    if avg_loss == 0.0:
        return 100.0 if avg_gain > 0.0 else 50.0
    return 100.0 - 100.0 / (1.0 + avg_gain / avg_loss)
