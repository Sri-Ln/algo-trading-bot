import numpy as np
import pandas as pd
import pytest

from algo_trading.indicators import RsiMethod, cumulative_return, rsi


def series(values: list[float]) -> pd.Series:
    return pd.Series(values, dtype=float)


class TestCumulativeReturn:
    def test_compares_today_with_n_days_ago(self) -> None:
        assert cumulative_return(series([100, 105, 110, 120]), 2) == pytest.approx(120 / 105 - 1)

    def test_needs_enough_history(self) -> None:
        with pytest.raises(ValueError, match="more than 3"):
            cumulative_return(series([1, 2, 3]), 3)

    def test_rejects_zero_days(self) -> None:
        with pytest.raises(ValueError):
            cumulative_return(series([1, 2]), 0)


class TestRsi:
    @pytest.mark.parametrize("method", ["wilder", "simple"])
    def test_only_gains_is_100(self, method: RsiMethod) -> None:
        assert rsi(series([1, 2, 3, 4, 5]), 3, method) == 100.0

    @pytest.mark.parametrize("method", ["wilder", "simple"])
    def test_only_losses_is_0(self, method: RsiMethod) -> None:
        assert rsi(series([5, 4, 3, 2, 1]), 3, method) == 0.0

    def test_flat_prices_are_neutral(self) -> None:
        assert rsi(series([3, 3, 3, 3]), 3) == 50.0

    def test_simple_matches_hand_calculation(self) -> None:
        # changes over the last 3 days: +2, -1, +1 -> avg gain 1, avg loss 1/3
        value = rsi(series([10, 9, 11, 10, 11]), 3, "simple")
        assert value == pytest.approx(100 - 100 / (1 + 1 / (1 / 3)))

    def test_wilder_matches_hand_calculation(self) -> None:
        # first 2 changes (+1, -1) seed avg gain 0.5 / loss 0.5; then +2 smooths in
        value = rsi(series([10, 11, 10, 12]), 2, "wilder")
        gain, loss = (0.5 * 1 + 2) / 2, (0.5 * 1 + 0) / 2
        assert value == pytest.approx(100 - 100 / (1 + gain / loss))

    def test_wilder_matches_pandas_ewm_once_converged(self, rng: np.random.Generator) -> None:
        prices = pd.Series(100 * np.exp(np.cumsum(rng.normal(0, 0.01, 600))))
        changes = prices.diff().dropna()
        gain = changes.clip(lower=0).ewm(alpha=1 / 14, adjust=False).mean().iloc[-1]
        loss = (-changes).clip(lower=0).ewm(alpha=1 / 14, adjust=False).mean().iloc[-1]
        assert rsi(prices, 14) == pytest.approx(100 - 100 / (1 + gain / loss), abs=1e-6)

    def test_needs_window_plus_one_prices(self) -> None:
        with pytest.raises(ValueError, match="at least 4"):
            rsi(series([1, 2, 3]), 3)
