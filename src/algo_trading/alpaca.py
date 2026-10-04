"""Broker adapter for Alpaca's trading REST API (paper trading by default)."""

from __future__ import annotations

import datetime as dt
import os
import time
from dataclasses import dataclass
from typing import Any

import httpx

from algo_trading.broker import (
    Account,
    Clock,
    DuplicateOrderError,
    Order,
    OrderRequest,
    OrderStatus,
    Position,
    Side,
)

PAPER_URL = "https://paper-api.alpaca.markets"
KEY_ID_VAR = "ALPACA_API_KEY_ID"
SECRET_VAR = "ALPACA_API_SECRET_KEY"

_FINAL_STATUSES = {
    "filled": OrderStatus.FILLED,
    "canceled": OrderStatus.CANCELED,
    "expired": OrderStatus.CANCELED,
    "done_for_day": OrderStatus.CANCELED,
    "rejected": OrderStatus.REJECTED,
    "suspended": OrderStatus.REJECTED,
}


@dataclass(frozen=True)
class ApiCall:
    """One HTTP request to the broker, for the run log. Never includes credentials."""

    at: dt.datetime
    method: str
    path: str
    status: int
    elapsed_ms: float


class AlpacaError(Exception):
    pass


class AlpacaBroker:
    def __init__(
        self,
        key_id: str,
        secret_key: str,
        base_url: str = PAPER_URL,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self.calls: list[ApiCall] = []
        self._client = httpx.Client(
            base_url=base_url,
            headers={"APCA-API-KEY-ID": key_id, "APCA-API-SECRET-KEY": secret_key},
            timeout=httpx.Timeout(20.0),
            transport=transport,
            event_hooks={"request": [self._start_timer], "response": [self._record]},
        )

    @classmethod
    def from_env(cls) -> AlpacaBroker:
        try:
            return cls(os.environ[KEY_ID_VAR], os.environ[SECRET_VAR])
        except KeyError as missing:
            raise AlpacaError(f"environment variable {missing} is not set") from None

    def clock(self) -> Clock:
        data = self._get("/v2/clock")
        return Clock(
            timestamp=dt.datetime.fromisoformat(data["timestamp"]),
            is_open=bool(data["is_open"]),
            next_open=dt.datetime.fromisoformat(data["next_open"]),
        )

    def account(self) -> Account:
        data = self._get("/v2/account")
        return Account(equity=float(data["equity"]), cash=float(data["cash"]))

    def positions(self) -> dict[str, Position]:
        return {
            p["symbol"]: Position(p["symbol"], float(p["qty"]), float(p["market_value"]))
            for p in self._get("/v2/positions")
        }

    def open_orders(self) -> list[Order]:
        return [_order(o) for o in self._get("/v2/orders", params={"status": "open"})]

    def submit_order(self, request: OrderRequest) -> Order:
        body = {
            "symbol": request.symbol,
            "qty": str(request.qty),
            "side": request.side.value,
            "type": "market",
            "time_in_force": "day",
            "client_order_id": request.client_order_id,
        }
        response = self._client.post("/v2/orders", json=body)
        if response.status_code == 422 and "client_order_id" in response.text:
            raise DuplicateOrderError(request.client_order_id)
        return _order(self._json(response))

    def get_order(self, order_id: str) -> Order:
        return _order(self._get(f"/v2/orders/{order_id}"))

    def close(self) -> None:
        self._client.close()

    def _get(self, path: str, params: dict[str, str] | None = None) -> Any:
        return self._json(self._client.get(path, params=params))

    @staticmethod
    def _json(response: httpx.Response) -> Any:
        if response.is_error:
            raise AlpacaError(
                f"{response.request.method} {response.request.url.path} -> "
                f"{response.status_code}: {response.text[:200]}"
            )
        return response.json()

    @staticmethod
    def _start_timer(request: httpx.Request) -> None:
        request.extensions["started"] = time.perf_counter()

    def _record(self, response: httpx.Response) -> None:
        started = response.request.extensions.get("started", time.perf_counter())
        self.calls.append(
            ApiCall(
                at=dt.datetime.now(dt.UTC),
                method=response.request.method,
                path=response.request.url.path,
                status=response.status_code,
                elapsed_ms=(time.perf_counter() - started) * 1000,
            )
        )


def _order(data: dict[str, Any]) -> Order:
    price = data.get("filled_avg_price")
    return Order(
        id=data["id"],
        client_order_id=data["client_order_id"],
        symbol=data["symbol"],
        side=Side(data["side"]),
        qty=int(float(data["qty"])),
        status=_FINAL_STATUSES.get(data["status"], OrderStatus.NEW),
        filled_qty=int(float(data.get("filled_qty") or 0)),
        filled_avg_price=float(price) if price is not None else None,
    )
