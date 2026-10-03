import math

import numpy as np
import pandas as pd
import pytest

from algo_trading.metrics import TRADING_DAYS, drawdown, summarize


def curve(values: list[float]) -> pd.Series:
    return pd.Series(values, index=pd.bdate_range("2020-01-01", periods=len(values)), dtype=float)


def test_drawdown_measures_distance_below_running_peak() -> None:
    dd = drawdown(curve([1.0, 2.0, 1.0, 1.5, 3.0]))
    assert list(dd) == pytest.approx([0.0, 0.0, -0.5, -0.25, 0.0])


def test_cagr_of_one_doubling_year() -> None:
    growth = 2 ** (1 / TRADING_DAYS)
    summary = summarize(curve([growth**i for i in range(TRADING_DAYS + 1)]))
    assert summary.cagr == pytest.approx(1.0)
    assert summary.years == pytest.approx(1.0)
    assert summary.max_drawdown == 0.0


def test_volatility_and_sharpe_annualize_daily_numbers(rng: np.random.Generator) -> None:
    daily = rng.normal(0.0005, 0.01, 5000)
    summary = summarize(curve(list(np.cumprod(np.r_[1.0, 1 + daily]))))
    assert summary.volatility == pytest.approx(daily.std(ddof=1) * math.sqrt(TRADING_DAYS))
    assert summary.sharpe == pytest.approx(
        daily.mean() / daily.std(ddof=1) * math.sqrt(TRADING_DAYS)
    )


def test_sharpe_subtracts_cash_returns(rng: np.random.Generator) -> None:
    daily = rng.normal(0.0005, 0.01, 1000)
    equity = curve(list(np.cumprod(np.r_[1.0, 1 + daily])))
    cash = pd.Series(0.0002, index=equity.index)
    with_cash, without = summarize(equity, cash), summarize(equity)
    assert with_cash.sharpe < without.sharpe
    assert with_cash.cagr == without.cagr


def test_flat_curve_has_zero_sharpe() -> None:
    assert summarize(curve([1.0] * 10)).sharpe == 0.0


def test_needs_two_points() -> None:
    with pytest.raises(ValueError):
        summarize(curve([1.0]))
