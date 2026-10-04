"""Daily price bars and the sources that provide them.

Everything downstream works on :class:`Bars`; where the prices came from is
decided here, behind the :class:`MarketData` port.
"""

from __future__ import annotations

import datetime as dt
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

import pandas as pd


@dataclass(frozen=True)
class Bars:
    """Split- and dividend-adjusted daily opens and closes.

    Both frames share one ascending DatetimeIndex (trading days) and one column
    per ticker, with no missing values.
    """

    open: pd.DataFrame
    close: pd.DataFrame

    def __post_init__(self) -> None:
        if not self.open.index.equals(self.close.index):
            raise ValueError("open and close must share the same dates")
        if list(self.open.columns) != list(self.close.columns):
            raise ValueError("open and close must share the same tickers")
        if not self.close.index.is_monotonic_increasing:
            raise ValueError("dates must be in ascending order")
        if self.open.isna().any().any() or self.close.isna().any().any():
            raise ValueError("bars contain missing values")

    @property
    def dates(self) -> pd.DatetimeIndex:
        return pd.DatetimeIndex(self.close.index)

    @property
    def tickers(self) -> list[str]:
        return [str(c) for c in self.close.columns]

    def until(self, date: pd.Timestamp) -> Bars:
        """Only the bars known at the close of ``date``."""
        return Bars(self.open.loc[:date], self.close.loc[:date])

    def between(self, start: pd.Timestamp, end: pd.Timestamp) -> Bars:
        return Bars(self.open.loc[start:end], self.close.loc[start:end])

    def to_long(self) -> pd.DataFrame:
        frames = {"open": self.open.stack(), "close": self.close.stack()}
        long = pd.concat(frames, axis=1).reset_index()
        long.columns = pd.Index(["date", "ticker", "open", "close"])
        return long

    @classmethod
    def from_long(cls, long: pd.DataFrame) -> Bars:
        wide = long.pivot(index="date", columns="ticker", values=["open", "close"])
        wide.index = pd.DatetimeIndex(wide.index, name="date")

        def field(name: str) -> pd.DataFrame:
            return pd.DataFrame(wide[name]).sort_index(axis=1).rename_axis(columns=None)

        return cls(open=field("open"), close=field("close"))


class MarketData(Protocol):
    """Port: anything that can supply daily bars for a date range (inclusive)."""

    def get_bars(self, tickers: Sequence[str], start: dt.date, end: dt.date) -> Bars: ...


class YFinanceMarketData:
    """Adjusted daily bars from Yahoo Finance via the ``yfinance`` package."""

    def get_bars(self, tickers: Sequence[str], start: dt.date, end: dt.date) -> Bars:
        import yfinance as yf

        raw = yf.download(
            list(tickers),
            start=start.isoformat(),
            end=(end + dt.timedelta(days=1)).isoformat(),  # yfinance's end is exclusive
            auto_adjust=True,
            progress=False,
            group_by="column",
            # Parallel downloads share yfinance's SQLite cache and can fail one
            # ticker with "database is locked"; 15 tickers in series is still fast.
            threads=False,
        )
        if raw is None or raw.empty:
            raise RuntimeError("no data returned from Yahoo Finance")
        opens = pd.DataFrame(raw["Open"])
        closes = pd.DataFrame(raw["Close"])
        missing = [t for t in tickers if t not in closes.columns or closes[t].isna().all()]
        if missing:
            raise RuntimeError(f"no data returned for {', '.join(missing)}")
        # Keep only days on which every ticker traded.
        complete = opens.notna().all(axis=1) & closes.notna().all(axis=1)
        index = pd.DatetimeIndex(closes.index[complete]).tz_localize(None).rename("date")
        order = sorted(tickers)
        return Bars(
            open=opens.loc[complete, order].set_axis(index),
            close=closes.loc[complete, order].set_axis(index),
        )


class CachedMarketData:
    """Wraps a source with a local Parquet file so backtests run offline.

    The cache is used whenever it already covers the requested tickers and
    dates; otherwise the full range is fetched again and the file replaced.
    """

    # Allowed gap between the requested end and the last cached day, for
    # weekends and holidays.
    _END_SLACK = dt.timedelta(days=5)

    def __init__(self, source: MarketData, path: Path) -> None:
        self._source = source
        self._path = path

    def get_bars(self, tickers: Sequence[str], start: dt.date, end: dt.date) -> Bars:
        cached = self._load()
        if cached is not None and self._covers(cached, tickers, start, end):
            return self._select(cached, tickers, start, end)
        fresh = self._source.get_bars(tickers, start, end)
        self._save(fresh)
        return fresh

    def _load(self) -> Bars | None:
        if not self._path.exists():
            return None
        return Bars.from_long(pd.read_parquet(self._path))

    def _save(self, bars: Bars) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        bars.to_long().to_parquet(self._path, index=False)

    @classmethod
    def _covers(cls, bars: Bars, tickers: Sequence[str], start: dt.date, end: dt.date) -> bool:
        first, last = bars.dates[0].date(), bars.dates[-1].date()
        return set(tickers) <= set(bars.tickers) and first <= start and last >= end - cls._END_SLACK

    @staticmethod
    def _select(bars: Bars, tickers: Sequence[str], start: dt.date, end: dt.date) -> Bars:
        cols = sorted(tickers)
        lo, hi = pd.Timestamp(start), pd.Timestamp(end)
        return Bars(bars.open.loc[lo:hi, cols], bars.close.loc[lo:hi, cols])
