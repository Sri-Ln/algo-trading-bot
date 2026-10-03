import datetime as dt

import pytest

from algo_trading.broker import Position, Side
from algo_trading.reconcile import client_order_id, plan_orders

DAY = dt.date(2026, 10, 5)
PRICES = {"AAA": 10.0, "BBB": 20.0, "CCC": 50.0}


def pos(symbol: str, qty: float) -> Position:
    return Position(symbol, qty, qty * PRICES[symbol])


def test_from_cash_buys_whole_shares_leaving_a_buffer() -> None:
    plan = plan_orders({"AAA": 0.5, "BBB": 0.5}, {}, 10_000, PRICES, DAY)
    assert [(o.symbol, o.side, o.qty) for o in plan.orders] == [
        ("AAA", Side.BUY, 495),  # 0.5 * 9,900 / 10
        ("BBB", Side.BUY, 247),  # 0.5 * 9,900 / 20, rounded down
    ]


def test_switching_sells_first_then_buys() -> None:
    plan = plan_orders({"CCC": 1.0}, {"AAA": pos("AAA", 1000)}, 10_000, PRICES, DAY)
    assert [(o.symbol, o.side) for o in plan.orders] == [("AAA", Side.SELL), ("CCC", Side.BUY)]
    assert plan.orders[0].qty == 1000
    assert plan.drift == pytest.approx(2.0)


def test_small_drift_needs_no_orders() -> None:
    positions = {"AAA": pos("AAA", 505), "BBB": pos("BBB", 247.5)}
    plan = plan_orders({"AAA": 0.5, "BBB": 0.5}, positions, 10_000, PRICES, DAY)
    assert plan.in_sync
    assert plan.drift == pytest.approx(0.01)


def test_drift_beyond_threshold_trims_and_tops_up() -> None:
    positions = {"AAA": pos("AAA", 600), "BBB": pos("BBB", 200)}  # 60/40 vs 50/50
    plan = plan_orders({"AAA": 0.5, "BBB": 0.5}, positions, 10_000, PRICES, DAY)
    assert [(o.symbol, o.side, o.qty) for o in plan.orders] == [
        ("AAA", Side.SELL, 105),
        ("BBB", Side.BUY, 47),
    ]


def test_order_ids_are_deterministic_per_day_fund_and_side() -> None:
    plan = plan_orders({"AAA": 1.0}, {}, 10_000, PRICES, DAY)
    assert plan.orders[0].client_order_id == "at-2026-10-05-AAA-buy"
    assert client_order_id(DAY, "AAA", Side.BUY) == plan.orders[0].client_order_id
    assert client_order_id(DAY + dt.timedelta(days=1), "AAA", Side.BUY) != "at-2026-10-05-AAA-buy"


def test_rejects_non_positive_equity() -> None:
    with pytest.raises(ValueError):
        plan_orders({"AAA": 1.0}, {}, 0, PRICES, DAY)
