from algo_trading import universe


def test_tickers_are_unique() -> None:
    assert len(set(universe.ALL_TICKERS)) == len(universe.ALL_TICKERS)


def test_signal_tickers_are_never_traded() -> None:
    assert not set(universe.SIGNAL_TICKERS) & set(universe.TRADED_TICKERS)


def test_universe_size() -> None:
    assert len(universe.SIGNAL_TICKERS) + len(universe.TRADED_TICKERS) == 14
