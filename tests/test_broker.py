import datetime as dt

import pytest

from algo_trading.broker import DuplicateOrderError, FakeBroker, OrderRequest, OrderStatus, Side

NOW = dt.datetime(2026, 10, 5, 13, 35, tzinfo=dt.UTC)


def broker() -> FakeBroker:
    return FakeBroker(cash=1000.0, prices={"AAA": 10.0, "BBB": 50.0}, now=NOW)


def test_buy_fills_at_the_set_price_and_moves_cash() -> None:
    b = broker()
    order = b.submit_order(OrderRequest("AAA", Side.BUY, 30, "id-1"))
    assert order.status is OrderStatus.FILLED
    assert order.filled_avg_price == 10.0
    assert b.account().cash == 700.0
    assert b.account().equity == 1000.0
    assert b.positions()["AAA"].qty == 30


def test_sell_closes_the_position() -> None:
    b = broker()
    b.submit_order(OrderRequest("AAA", Side.BUY, 30, "id-1"))
    b.submit_order(OrderRequest("AAA", Side.SELL, 30, "id-2"))
    assert b.positions() == {}
    assert b.account().cash == 1000.0


def test_orders_beyond_cash_or_holdings_are_rejected() -> None:
    b = broker()
    assert b.submit_order(OrderRequest("BBB", Side.BUY, 21, "a")).status is OrderStatus.REJECTED
    assert b.submit_order(OrderRequest("AAA", Side.SELL, 1, "b")).status is OrderStatus.REJECTED


def test_reusing_a_client_order_id_is_refused() -> None:
    b = broker()
    b.submit_order(OrderRequest("AAA", Side.BUY, 1, "same"))
    with pytest.raises(DuplicateOrderError):
        b.submit_order(OrderRequest("AAA", Side.BUY, 1, "same"))
    assert b.positions()["AAA"].qty == 1


def test_clock_reports_market_state() -> None:
    closed = FakeBroker(cash=0.0, prices={}, now=NOW, is_open=False)
    assert closed.clock().is_open is False
    assert closed.clock().timestamp == NOW
