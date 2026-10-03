import datetime as dt
from collections.abc import Sequence

import pandas as pd

from algo_trading import universe
from algo_trading.broker import FakeBroker
from algo_trading.live import LiveConfig, run_live
from algo_trading.market_data import Bars
from tests.conftest import FakeMarketData
from tests.test_strategy import closes as universe_closes

CLOSE = universe_closes(AGG=0.001, SOXL=0.0005)  # steady risk on: buys TECL + TQQQ
LAST_DAY = CLOSE.index[-1]
BARS = Bars(open=CLOSE.shift(1).fillna(CLOSE), close=CLOSE)
# 09:35 New York time on the next trading day.
NOW = (LAST_DAY + pd.offsets.BDay(1)).replace(hour=13, minute=35).tz_localize("UTC").to_pydatetime()
NO_WAIT = LiveConfig(poll_interval_s=0)


def make_broker(is_open: bool = True) -> FakeBroker:
    prices = {t: float(CLOSE[t].iloc[-1]) for t in universe.TRADED_TICKERS}
    return FakeBroker(cash=100_000.0, prices=prices, now=NOW, is_open=is_open)


def test_market_closed_skips_the_run() -> None:
    record = run_live(FakeMarketData(BARS), make_broker(is_open=False), NOW, NO_WAIT)
    assert record.status == "skipped"
    assert [s.name for s in record.steps] == ["check_clock"]


def test_first_run_buys_the_target_portfolio() -> None:
    broker = make_broker()
    record = run_live(FakeMarketData(BARS), broker, NOW, NO_WAIT)
    assert record.status == "ok", record.error
    assert [s.name for s in record.steps] == [
        "check_clock",
        "fetch_bars",
        "decide",
        "reconcile",
        "submit_orders",
    ]
    assert record.decision is not None and record.decision["regime"] == "risk_on"
    assert {o["symbol"] for o in record.orders} == {"TECL", "TQQQ"}
    assert all(o["status"] == "filled" for o in record.orders)
    assert set(broker.positions()) == {"TECL", "TQQQ"}


def test_rerunning_the_same_day_does_not_trade_again() -> None:
    broker = make_broker()
    run_live(FakeMarketData(BARS), broker, NOW, NO_WAIT)
    again = run_live(FakeMarketData(BARS), broker, NOW, NO_WAIT)
    assert again.status == "ok"
    assert again.steps[-1].status == "skipped"
    assert len(broker.orders) == 2


def test_dry_run_plans_but_sends_nothing() -> None:
    broker = make_broker()
    record = run_live(FakeMarketData(BARS), broker, NOW, LiveConfig(dry_run=True))
    assert record.dry_run
    assert {o["status"] for o in record.orders} == {"planned"}
    assert broker.orders == {}


def test_todays_partial_bar_is_ignored() -> None:
    today = pd.Timestamp(NOW.date())
    with_today = pd.concat([CLOSE, CLOSE.iloc[[-1]].set_axis([today]) * 2])
    bars = Bars(open=with_today.shift(1).fillna(with_today), close=with_today)
    record = run_live(FakeMarketData(bars), make_broker(), NOW, NO_WAIT)
    assert record.decision is not None
    assert record.decision["date"] == LAST_DAY.date().isoformat()


def test_stale_prices_fail_the_run_without_trading() -> None:
    later = NOW + dt.timedelta(days=30)
    broker = make_broker()
    record = run_live(FakeMarketData(BARS), broker, later, NO_WAIT)
    assert record.status == "failed"
    assert record.error is not None and "too old" in record.error
    assert record.steps[-1].name == "fetch_bars"
    assert broker.orders == {}


class FlakyMarketData(FakeMarketData):
    def get_bars(self, tickers: Sequence[str], start: dt.date, end: dt.date) -> Bars:
        if self.calls == 0:
            self.calls += 1
            raise TimeoutError("data source timed out")
        return super().get_bars(tickers, start, end)


def test_transient_data_errors_are_retried() -> None:
    waits: list[float] = []
    record = run_live(FlakyMarketData(BARS), make_broker(), NOW, NO_WAIT, sleep=waits.append)
    assert record.status == "ok"
    assert record.steps[1].detail["attempts"] == 2
    assert waits == [5.0]


def test_record_serializes_to_plain_json_types() -> None:
    import json

    record = run_live(FakeMarketData(BARS), make_broker(), NOW, NO_WAIT)
    assert json.loads(json.dumps(record.to_dict()))["trading_day"] == NOW.date().isoformat()
