"""The fixed set of ETFs the strategy reads signals from or trades."""

from typing import Final

# Signal inputs: read every day, never held.
BONDS: Final = "AGG"
CASH: Final = "BIL"
LONG_BONDS: Final = "TLT"

# Risk on: 3x leveraged equity funds, ranked by RSI.
RISK_ON: Final = ("SOXL", "TQQQ", "UPRO", "TECL")

# Risk off, rising rates: the dollar plus the lower-RSI of two short funds.
DOLLAR: Final = "UUP"
RISING_RATES_HEDGES: Final = ("QID", "TBF")

# Risk off, falling rates: equal-weight defensive basket.
FALLING_RATES_BASKET: Final = ("UGL", "TMF", "BTAL", "XLP")

BENCHMARK: Final = "SPY"

SIGNAL_TICKERS: Final = (BONDS, CASH, LONG_BONDS)
TRADED_TICKERS: Final = (*RISK_ON, DOLLAR, *RISING_RATES_HEDGES, *FALLING_RATES_BASKET)
ALL_TICKERS: Final = (*SIGNAL_TICKERS, *TRADED_TICKERS, BENCHMARK)
