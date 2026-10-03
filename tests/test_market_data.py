import datetime as dt
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from algo_trading.market_data import Bars, CachedMarketData, YFinanceMarketData
from tests.conftest import FakeMarketData, make_bars


def test_bars_rejects_missing_values() -> None:
    bars = make_bars({"AAA": [1.0, 2.0, 3.0]})
    close = bars.close.copy()
    close.iloc[1, 0] = np.nan
    with pytest.raises(ValueError, match="missing"):
        Bars(open=bars.open, close=close)


def test_bars_rejects_mismatched_dates() -> None:
    bars = make_bars({"AAA": [1.0, 2.0, 3.0]})
    with pytest.raises(ValueError, match="same dates"):
        Bars(open=bars.open.iloc[:2], close=bars.close)


def test_until_excludes_later_days() -> None:
    bars = make_bars({"AAA": [1.0, 2.0, 3.0, 4.0]})
    cut = bars.until(bars.dates[1])
    assert list(cut.close["AAA"]) == [1.0, 2.0]


def test_long_format_round_trip() -> None:
    bars = make_bars({"BBB": [5.0, 6.0], "AAA": [1.0, 2.0]})
    back = Bars.from_long(bars.to_long())
    pd.testing.assert_frame_equal(back.close, bars.close.sort_index(axis=1), check_freq=False)
    pd.testing.assert_frame_equal(back.open, bars.open.sort_index(axis=1), check_freq=False)


def test_cache_fetches_once_then_reads_from_disk(tmp_path: Path) -> None:
    bars = make_bars({"AAA": list(np.linspace(1, 2, 30)), "BBB": list(np.linspace(3, 4, 30))})
    source = FakeMarketData(bars)
    cache = CachedMarketData(source, tmp_path / "bars.parquet")
    start, end = bars.dates[0].date(), bars.dates[-1].date()

    first = cache.get_bars(["AAA", "BBB"], start, end)
    second = cache.get_bars(["AAA"], start, end - dt.timedelta(days=7))

    assert source.calls == 1
    assert first.tickers == ["AAA", "BBB"]
    assert second.tickers == ["AAA"]
    assert second.dates[-1].date() <= end - dt.timedelta(days=7)


def test_cache_refetches_when_a_ticker_is_missing(tmp_path: Path) -> None:
    bars = make_bars({"AAA": [1.0, 2.0, 3.0], "BBB": [4.0, 5.0, 6.0]})
    source = FakeMarketData(bars)
    cache = CachedMarketData(source, tmp_path / "bars.parquet")
    start, end = bars.dates[0].date(), bars.dates[-1].date()

    cache.get_bars(["AAA"], start, end)
    cache.get_bars(["AAA", "BBB"], start, end)

    assert source.calls == 2


@pytest.mark.network
def test_yfinance_returns_adjusted_bars() -> None:
    bars = YFinanceMarketData().get_bars(["SPY", "BIL"], dt.date(2024, 1, 2), dt.date(2024, 1, 31))
    assert bars.tickers == ["BIL", "SPY"]
    assert 19 <= len(bars.dates) <= 21
