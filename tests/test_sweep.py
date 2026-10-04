import numpy as np
import pandas as pd
import pytest

from algo_trading import universe
from algo_trading.backtest import BacktestConfig, run_backtest
from algo_trading.market_data import Bars
from algo_trading.metrics import summarize_split
from algo_trading.strategy import Params
from algo_trading.sweep import cost_sensitivity, parameter_sweep

CONFIG = BacktestConfig(Params(bond_lookback=5, long_bond_lookback=3, rsi_history=20))


@pytest.fixture
def bars(rng: np.random.Generator) -> Bars:
    days = 200
    walk = {t: 100 * np.cumprod(1 + rng.normal(0, 0.02, days)) for t in universe.ALL_TICKERS}
    close = pd.DataFrame(walk, index=pd.bdate_range("2020-01-01", periods=days, name="date"))
    return Bars(open=close.shift(1).fillna(close), close=close)


def holdout(bars: Bars) -> pd.Timestamp:
    return pd.Timestamp(bars.dates[150])


def test_sweep_covers_every_combination_in_order(bars: Bars) -> None:
    cells = parameter_sweep(bars, CONFIG, holdout(bars), (3, 5), (4, 6, 8))
    assert [(c.bond_lookback, c.risk_on_rsi_window) for c in cells] == [
        (3, 4), (3, 6), (3, 8), (5, 4), (5, 6), (5, 8),
    ]  # fmt: skip
    assert set(cells[0].periods) == {"full", "before_holdout", "holdout"}


def test_sweep_cell_matches_a_direct_backtest(bars: Bars) -> None:
    (cell,) = parameter_sweep(bars, CONFIG, holdout(bars), (4,), (6,))
    params = Params(bond_lookback=4, long_bond_lookback=3, risk_on_rsi_window=6, rsi_history=20)
    direct = run_backtest(bars, BacktestConfig(params))
    expected = summarize_split(direct.equity, direct.cash_returns, holdout(bars))
    assert cell.periods == expected
    assert cell.trades_per_year == pytest.approx(
        len(direct.trades) / ((len(direct.equity) - 1) / 252)
    )


def test_higher_costs_lower_every_return(bars: Bars) -> None:
    result = run_backtest(bars, CONFIG)
    points = cost_sensitivity(result, holdout(bars), (0.0, 5.0, 25.0))
    assert [p.cost_bps for p in points] == [0.0, 5.0, 25.0]
    cagr = [p.periods["full"].cagr for p in points]
    drag = [p.cost_drag for p in points]
    assert cagr == sorted(cagr, reverse=True)
    assert drag[0] == 0.0
    assert drag[2] == pytest.approx(5 * drag[1])
    assert points[1].periods == summarize_split(result.equity, result.cash_returns, holdout(bars))
