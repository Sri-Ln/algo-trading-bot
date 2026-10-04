import numpy as np
import pandas as pd
import pytest

from algo_trading import universe
from algo_trading.backtest import BacktestConfig, DecideFn, run_backtest, with_cost
from algo_trading.market_data import Bars
from algo_trading.strategy import Decision, Params, Regime, strategy
from tests.test_strategy import closes as universe_closes

# Small windows so a handful of days is enough history: decisions start on day 2.
PARAMS = Params(bond_lookback=2, long_bond_lookback=2, rsi_history=2)


def bars_from(open_: dict[str, list[float]], close: dict[str, list[float]]) -> Bars:
    days = len(next(iter(close.values())))
    index = pd.bdate_range("2024-01-01", periods=days, name="date")
    flat = {"SPY": [100.0] * days, "BIL": [100.0] * days}
    return Bars(
        open=pd.DataFrame({**open_, **flat}, index=index),
        close=pd.DataFrame({**close, **flat}, index=index),
    )


def hold(bars: Bars, schedule: dict[int, dict[str, float]]) -> DecideFn:
    """A fake strategy: from day ``n`` onwards, hold ``schedule[n]``."""

    def decide(closes: pd.DataFrame, params: Params) -> Decision:
        today = pd.Timestamp(closes.index[-1])
        day = int(bars.dates.searchsorted(today))
        weights = schedule[max(k for k in schedule if k <= day)]
        return Decision(today, Regime.RISK_ON, (), weights)

    return decide


def test_trades_fill_at_next_open_so_overnight_gap_is_missed() -> None:
    # Decide on day 2's close; A gaps +20% overnight, then rises 10% during day 3.
    bars = bars_from(
        open_={"A": [10, 10, 10, 12, 13.2]},
        close={"A": [10, 10, 10, 13.2, 13.2]},
    )
    result = run_backtest(bars, BacktestConfig(PARAMS, cost_bps=0), hold(bars, {0: {"A": 1.0}}))
    assert list(result.equity) == pytest.approx([1.0, 1.1, 1.1])


def test_costs_are_charged_on_every_dollar_traded() -> None:
    flat = [10.0] * 6
    bars = bars_from(open_={"A": flat, "B": flat}, close={"A": flat, "B": flat})
    fake = hold(bars, {0: {"A": 1.0}, 3: {"B": 1.0}})
    result = run_backtest(bars, BacktestConfig(PARAMS, cost_bps=10), fake)
    assert [t.turnover for t in result.trades] == [1.0, 2.0]
    assert result.equity.iloc[-1] == pytest.approx((1 - 0.001) * (1 - 0.002))


def test_small_drift_does_not_trigger_a_trade() -> None:
    bars = bars_from(
        open_={"A": [10, 10, 10, 10, 11], "B": [10] * 5},
        close={"A": [10, 10, 10, 11, 11], "B": [10] * 5},
    )
    half = hold(bars, {0: {"A": 0.5, "B": 0.5}})
    loose = run_backtest(bars, BacktestConfig(PARAMS, rebalance_threshold=0.1), half)
    tight = run_backtest(bars, BacktestConfig(PARAMS, rebalance_threshold=0.01), half)
    assert len(loose.trades) == 1  # only the initial buy
    assert len(tight.trades) == 2  # initial buy, then rebalance after A's 10% day


def test_each_decision_sees_only_prices_up_to_its_own_day() -> None:
    seen: list[pd.Timestamp] = []

    def spy_on(closes: pd.DataFrame, params: Params) -> Decision:
        seen.append(pd.Timestamp(closes.index[-1]))
        return Decision(seen[-1], Regime.RISK_ON, (), {"A": 1.0})

    flat = [10.0] * 6
    bars = bars_from(open_={"A": flat}, close={"A": flat})
    run_backtest(bars, BacktestConfig(PARAMS), spy_on)
    assert seen == list(bars.dates[2:])


def test_start_and_end_dates_limit_the_run() -> None:
    flat = [10.0] * 10
    bars = bars_from(open_={"A": flat}, close={"A": flat})
    config = BacktestConfig(PARAMS, start=bars.dates[4], end=bars.dates[7])
    result = run_backtest(bars, config, hold(bars, {0: {"A": 1.0}}))
    assert result.equity.index[0] == bars.dates[4]
    assert result.equity.index[-1] == bars.dates[7]


def test_benchmark_and_equity_start_at_one() -> None:
    flat = [10.0] * 5
    bars = bars_from(open_={"A": flat}, close={"A": flat})
    result = run_backtest(bars, BacktestConfig(PARAMS), hold(bars, {0: {"A": 1.0}}))
    assert result.equity.iloc[0] == 1.0
    assert result.benchmark.iloc[0] == 1.0


def test_runs_end_to_end_with_the_real_strategy() -> None:
    close = universe_closes(AGG=0.001, SOXL=0.0005)
    bars = Bars(open=close.shift(1).fillna(close), close=close)
    result = run_backtest(bars, decide=strategy)
    assert set(result.regimes) == {"risk_on"}
    assert len(result.equity) == len(close) - Params().bars_needed + 1
    assert result.trades[0].after == {"TECL": 0.5, "TQQQ": 0.5}


def test_rejects_too_little_history() -> None:
    flat = [10.0] * 3
    with pytest.raises(ValueError, match="not enough history"):
        run_backtest(bars_from(open_={"A": flat}, close={"A": flat}), BacktestConfig(PARAMS))


@pytest.mark.parametrize("cost_bps", [0.0, 3.0, 25.0])
def test_with_cost_matches_a_full_rerun(rng: np.random.Generator, cost_bps: float) -> None:
    days = 300
    walk = {t: 100 * np.cumprod(1 + rng.normal(0, 0.02, days)) for t in universe.ALL_TICKERS}
    close = pd.DataFrame(walk, index=pd.bdate_range("2020-01-01", periods=days, name="date"))
    bars = Bars(open=close.shift(1).fillna(close) * 1.001, close=close)
    params = Params(bond_lookback=5, long_bond_lookback=3, rsi_history=20)
    base = run_backtest(bars, BacktestConfig(params, cost_bps=5.0))
    rerun = run_backtest(bars, BacktestConfig(params, cost_bps=cost_bps))
    repriced = with_cost(base, cost_bps)

    assert len(base.trades) > 10
    assert repriced.config == rerun.config
    pd.testing.assert_series_equal(repriced.equity, rerun.equity, rtol=1e-12)
    assert [t.cost for t in repriced.trades] == pytest.approx([t.cost for t in rerun.trades])
