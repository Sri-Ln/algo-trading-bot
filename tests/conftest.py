import datetime as dt
from collections.abc import Sequence

import numpy as np
import pandas as pd
import pytest

from algo_trading.market_data import Bars


def make_bars(closes: dict[str, Sequence[float]], start: str = "2020-01-01") -> Bars:
    """Bars from close prices; each day opens at the previous close."""
    days = len(next(iter(closes.values())))
    close = pd.DataFrame(closes, index=pd.bdate_range(start, periods=days, name="date"))
    open_ = close.shift(1).fillna(close)
    return Bars(open=open_, close=close)


class FakeMarketData:
    """In-memory MarketData that records how often it was asked."""

    def __init__(self, bars: Bars) -> None:
        self.bars = bars
        self.calls = 0

    def get_bars(self, tickers: Sequence[str], start: dt.date, end: dt.date) -> Bars:
        self.calls += 1
        cols = sorted(tickers)
        lo, hi = pd.Timestamp(start), pd.Timestamp(end)
        return Bars(self.bars.open.loc[lo:hi, cols], self.bars.close.loc[lo:hi, cols])


@pytest.fixture
def rng() -> np.random.Generator:
    return np.random.default_rng(7)
