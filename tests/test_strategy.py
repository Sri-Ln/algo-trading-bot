import numpy as np
import pandas as pd
import pytest

from algo_trading import universe
from algo_trading.strategy import Params, Regime, strategy

DAYS = 300


def closes(**trends: float) -> pd.DataFrame:
    """Prices for every ticker; each grows at a constant daily rate (default flat).

    A small zig-zag keeps RSI defined; ``trends`` maps ticker -> daily drift.
    """
    t = np.arange(DAYS)
    wiggle = 0.001 * np.where(t % 2 == 0, 1.0, -1.0)
    data = {
        ticker: 100 * np.exp(trends.get(ticker, 0.0) * t + wiggle)
        for ticker in universe.ALL_TICKERS
    }
    return pd.DataFrame(data, index=pd.bdate_range("2020-01-01", periods=DAYS))


def test_bonds_beating_cash_is_risk_on() -> None:
    decision = strategy(closes(AGG=0.001))
    assert decision.regime is Regime.RISK_ON
    assert decision.checks[0].passed
    assert len(decision.checks) == 1


def test_risk_on_buys_the_two_lowest_rsi_funds() -> None:
    # Falling funds have low RSI; SOXL and TECL fall, the others rise.
    prices = closes(AGG=0.001, SOXL=-0.002, TECL=-0.001, TQQQ=0.002, UPRO=0.001)
    decision = strategy(prices)
    assert decision.weights == {"SOXL": 0.5, "TECL": 0.5}
    assert list(decision.rsi) == ["SOXL", "TECL", "UPRO", "TQQQ"]


def test_long_bonds_trailing_cash_is_rising_rates() -> None:
    decision = strategy(closes(AGG=-0.001, TLT=-0.002, QID=0.001, TBF=-0.001))
    assert decision.regime is Regime.RISK_OFF_RISING
    assert decision.weights == {"UUP": 0.5, "TBF": 0.5}
    assert [c.passed for c in decision.checks] == [False, True]


def test_otherwise_falling_rates_basket() -> None:
    decision = strategy(closes(AGG=-0.001, TLT=0.002))
    assert decision.regime is Regime.RISK_OFF_FALLING
    assert decision.weights == {t: 0.25 for t in universe.FALLING_RATES_BASKET}
    assert decision.rsi == {}


@pytest.mark.parametrize(
    "trends", [{"AGG": 0.001}, {"AGG": -0.001, "TLT": -0.002}, {"AGG": -0.001, "TLT": 0.002}]
)
def test_weights_sum_to_one(trends: dict[str, float]) -> None:
    assert sum(strategy(closes(**trends)).weights.values()) == pytest.approx(1.0)


def test_ties_break_alphabetically() -> None:
    decision = strategy(closes(AGG=0.001))
    assert decision.weights == {"SOXL": 0.5, "TECL": 0.5}


def test_uses_only_the_last_row_as_today() -> None:
    prices = closes(AGG=0.001)
    assert strategy(prices).date == prices.index[-1]
    assert strategy(prices.iloc[:-5]).date == prices.index[-6]


def test_decision_ignores_history_beyond_the_window() -> None:
    prices = closes(AGG=0.001, SOXL=-0.002, TECL=-0.001)
    needed = Params().bars_needed
    full, trimmed = strategy(prices), strategy(prices.iloc[-needed:])
    assert full == trimmed


def test_needs_enough_history() -> None:
    with pytest.raises(ValueError, match="need 251 days"):
        strategy(closes().iloc[:100])


def test_gap_and_json_shape() -> None:
    decision = strategy(closes(AGG=0.001))
    payload = decision.to_dict()
    check = payload["checks"][0]
    assert payload["regime"] == "risk_on"
    assert check["gap"] == pytest.approx(check["left_return"] - check["right_return"])
    assert set(payload) == {"date", "regime", "checks", "rsi", "weights"}
