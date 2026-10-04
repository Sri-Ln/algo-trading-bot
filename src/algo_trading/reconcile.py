"""Turn target weights and current holdings into the orders that close the gap."""

from __future__ import annotations

import datetime as dt
import math
from dataclasses import dataclass

from algo_trading.broker import OrderRequest, Position, Side


@dataclass(frozen=True)
class Plan:
    current: dict[str, float]  # weight of each holding, as a fraction of equity
    target: dict[str, float]
    drift: float  # sum of |target - current| over all funds
    orders: list[OrderRequest]

    @property
    def in_sync(self) -> bool:
        return not self.orders


def client_order_id(day: dt.date, symbol: str, side: Side) -> str:
    """Same day, fund and side always give the same id, so a rerun cannot trade twice."""
    return f"at-{day.isoformat()}-{symbol}-{side.value}"


def plan_orders(
    target: dict[str, float],
    positions: dict[str, Position],
    equity: float,
    prices: dict[str, float],
    day: dt.date,
    threshold: float = 0.02,
    cash_buffer: float = 0.01,
) -> Plan:
    """Orders to move from ``positions`` to ``target`` weights, in whole shares.

    Nothing is traded while total drift is within ``threshold``. ``cash_buffer``
    of equity is left uninvested so fills a little above the last price do not
    need margin. Sells come first so their proceeds fund the buys.
    """
    if equity <= 0:
        raise ValueError("equity must be positive")
    current = {s: p.market_value / equity for s, p in positions.items()}
    symbols = sorted(current.keys() | target.keys())
    drift = sum(abs(target.get(s, 0.0) - current.get(s, 0.0)) for s in symbols)
    if drift <= threshold:
        return Plan(current, target, drift, [])

    investable = equity * (1.0 - cash_buffer)
    sells: list[OrderRequest] = []
    buys: list[OrderRequest] = []
    for symbol in symbols:
        held = int(positions[symbol].qty) if symbol in positions else 0
        weight = target.get(symbol, 0.0)
        wanted = math.floor(weight * investable / prices[symbol]) if weight else 0
        change = wanted - held
        if change < 0:
            sells.append(
                OrderRequest(symbol, Side.SELL, -change, client_order_id(day, symbol, Side.SELL))
            )
        elif change > 0:
            buys.append(
                OrderRequest(symbol, Side.BUY, change, client_order_id(day, symbol, Side.BUY))
            )
    return Plan(current, target, drift, sells + buys)
