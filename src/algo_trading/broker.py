"""The Broker port: what the live runner needs from a brokerage, and an in-memory fake."""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, replace
from enum import StrEnum
from typing import Protocol


class Side(StrEnum):
    BUY = "buy"
    SELL = "sell"


class OrderStatus(StrEnum):
    NEW = "new"
    FILLED = "filled"
    REJECTED = "rejected"
    CANCELED = "canceled"

    @property
    def is_final(self) -> bool:
        return self is not OrderStatus.NEW


@dataclass(frozen=True)
class Clock:
    timestamp: dt.datetime
    is_open: bool
    next_open: dt.datetime


@dataclass(frozen=True)
class Account:
    equity: float
    cash: float


@dataclass(frozen=True)
class Position:
    symbol: str
    qty: float
    market_value: float


@dataclass(frozen=True)
class OrderRequest:
    symbol: str
    side: Side
    qty: int
    # Unique per intended order; the broker refuses a second order with the same
    # id, so a retried run cannot trade twice.
    client_order_id: str


@dataclass(frozen=True)
class Order:
    id: str
    client_order_id: str
    symbol: str
    side: Side
    qty: int
    status: OrderStatus
    filled_qty: int = 0
    filled_avg_price: float | None = None


class DuplicateOrderError(Exception):
    """An order with this client_order_id was already submitted."""


class Broker(Protocol):
    def clock(self) -> Clock: ...

    def account(self) -> Account: ...

    def positions(self) -> dict[str, Position]: ...

    def open_orders(self) -> list[Order]: ...

    def submit_order(self, request: OrderRequest) -> Order: ...

    def get_order(self, order_id: str) -> Order: ...


class FakeBroker:
    """In-memory broker for tests: market orders fill immediately at set prices."""

    def __init__(
        self,
        cash: float,
        prices: dict[str, float],
        now: dt.datetime,
        is_open: bool = True,
    ) -> None:
        self.cash = cash
        self.prices = dict(prices)
        self.now = now
        self.is_open = is_open
        self.holdings: dict[str, float] = {}
        self.orders: dict[str, Order] = {}

    def clock(self) -> Clock:
        return Clock(self.now, self.is_open, self.now + dt.timedelta(days=1))

    def account(self) -> Account:
        value = sum(qty * self.prices[s] for s, qty in self.holdings.items())
        return Account(equity=self.cash + value, cash=self.cash)

    def positions(self) -> dict[str, Position]:
        return {
            s: Position(s, qty, qty * self.prices[s]) for s, qty in self.holdings.items() if qty
        }

    def open_orders(self) -> list[Order]:
        return [o for o in self.orders.values() if not o.status.is_final]

    def submit_order(self, request: OrderRequest) -> Order:
        if any(o.client_order_id == request.client_order_id for o in self.orders.values()):
            raise DuplicateOrderError(request.client_order_id)
        order = Order(
            id=f"fake-{len(self.orders) + 1}",
            client_order_id=request.client_order_id,
            symbol=request.symbol,
            side=request.side,
            qty=request.qty,
            status=OrderStatus.NEW,
        )
        self.orders[order.id] = self._fill(order)
        return self.orders[order.id]

    def get_order(self, order_id: str) -> Order:
        return self.orders[order_id]

    def _fill(self, order: Order) -> Order:
        price = self.prices[order.symbol]
        sign = 1 if order.side is Side.BUY else -1
        held = self.holdings.get(order.symbol, 0.0)
        if (sign > 0 and order.qty * price > self.cash) or (sign < 0 and order.qty > held):
            return replace(order, status=OrderStatus.REJECTED)
        self.cash -= sign * order.qty * price
        self.holdings[order.symbol] = held + sign * order.qty
        return replace(
            order, status=OrderStatus.FILLED, filled_qty=order.qty, filled_avg_price=price
        )
