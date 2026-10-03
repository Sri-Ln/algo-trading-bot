import json
from typing import Any

import httpx
import pytest

from algo_trading.alpaca import AlpacaBroker, AlpacaError
from algo_trading.broker import DuplicateOrderError, OrderRequest, OrderStatus, Side

ORDER = {
    "id": "ord-1",
    "client_order_id": "at-2026-10-05-AAA-buy",
    "symbol": "AAA",
    "side": "buy",
    "qty": "10",
    "status": "filled",
    "filled_qty": "10",
    "filled_avg_price": "12.5",
}


def broker(
    routes: dict[tuple[str, str], tuple[int, Any]],
) -> tuple[AlpacaBroker, list[httpx.Request]]:
    seen: list[httpx.Request] = []

    def handle(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        status, body = routes[(request.method, request.url.path)]
        return httpx.Response(status, json=body)

    return AlpacaBroker("key", "secret", transport=httpx.MockTransport(handle)), seen


def test_sends_credentials_as_headers() -> None:
    b, seen = broker({("GET", "/v2/account"): (200, {"equity": "1000.5", "cash": "10"})})
    account = b.account()
    assert (account.equity, account.cash) == (1000.5, 10.0)
    assert seen[0].headers["APCA-API-KEY-ID"] == "key"
    assert seen[0].headers["APCA-API-SECRET-KEY"] == "secret"


def test_parses_clock_and_positions() -> None:
    b, _ = broker(
        {
            ("GET", "/v2/clock"): (
                200,
                {
                    "timestamp": "2026-10-05T09:35:00-04:00",
                    "is_open": True,
                    "next_open": "2026-10-06T09:30:00-04:00",
                },
            ),
            ("GET", "/v2/positions"): (
                200,
                [{"symbol": "AAA", "qty": "3", "market_value": "37.5"}],
            ),
        }
    )
    assert b.clock().is_open
    assert b.positions()["AAA"].market_value == 37.5


def test_submits_a_market_day_order_with_the_client_id() -> None:
    b, seen = broker({("POST", "/v2/orders"): (200, ORDER)})
    order = b.submit_order(OrderRequest("AAA", Side.BUY, 10, "at-2026-10-05-AAA-buy"))
    body = json.loads(seen[0].content)
    assert body == {
        "symbol": "AAA",
        "qty": "10",
        "side": "buy",
        "type": "market",
        "time_in_force": "day",
        "client_order_id": "at-2026-10-05-AAA-buy",
    }
    assert order.status is OrderStatus.FILLED
    assert order.filled_avg_price == 12.5


def test_duplicate_client_order_id_raises() -> None:
    b, _ = broker({("POST", "/v2/orders"): (422, {"message": "client_order_id must be unique"})})
    with pytest.raises(DuplicateOrderError):
        b.submit_order(OrderRequest("AAA", Side.BUY, 10, "at-2026-10-05-AAA-buy"))


def test_working_orders_map_to_new() -> None:
    working = {**ORDER, "status": "partially_filled", "filled_avg_price": None}
    b, _ = broker({("GET", "/v2/orders/ord-1"): (200, working)})
    assert b.get_order("ord-1").status is OrderStatus.NEW


def test_errors_raise_with_status_but_no_secrets() -> None:
    b, _ = broker({("GET", "/v2/account"): (403, {"message": "forbidden"})})
    with pytest.raises(AlpacaError, match="403") as err:
        b.account()
    assert "secret" not in str(err.value)


def test_records_each_call_without_credentials() -> None:
    b, _ = broker({("GET", "/v2/account"): (200, {"equity": "1", "cash": "1"})})
    b.account()
    call = b.calls[0]
    assert (call.method, call.path, call.status) == ("GET", "/v2/account", 200)
    assert "secret" not in repr(call)


def test_from_env_reports_missing_keys(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ALPACA_API_KEY_ID", raising=False)
    with pytest.raises(AlpacaError, match="ALPACA_API_KEY_ID"):
        AlpacaBroker.from_env()
