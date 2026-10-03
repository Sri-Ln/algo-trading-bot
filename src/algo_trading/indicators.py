"""Price indicators used by the strategy. Each returns today's value only."""

from typing import Literal

import numpy as np
import numpy.typing as npt
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
    changes = np.diff(prices.to_numpy(dtype=float))
    if len(changes) < window:
        raise ValueError(f"need at least {window + 1} prices, got {len(prices)}")
    gains = np.clip(changes, 0.0, None)
    losses = np.clip(-changes, 0.0, None)

    if method == "simple":
        avg_gain = float(gains[-window:].mean())
        avg_loss = float(losses[-window:].mean())
    else:
        avg_gain = _wilder_average(gains, window)
        avg_loss = _wilder_average(losses, window)

    if avg_loss == 0.0:
        return 100.0 if avg_gain > 0.0 else 50.0
    return 100.0 - 100.0 / (1.0 + avg_gain / avg_loss)


def _wilder_average(values: npt.NDArray[np.float64], window: int) -> float:
    """Simple average of the first ``window`` values, then smoothing by 1/window.

    Unrolling avg = (avg * (window - 1) + x) / window over the remaining values
    gives a weighted sum: the seed is weighted by keep**n and the k-th of n later
    values by alpha * keep**(n - k), with alpha = 1/window and keep = 1 - alpha.
    """
    rest = values[window:]
    alpha = 1.0 / window
    keep = 1.0 - alpha
    powers = keep ** np.arange(len(rest) - 1, -1, -1)
    seed = float(values[:window].mean())
    return seed * keep ** len(rest) + alpha * float(powers @ rest)
