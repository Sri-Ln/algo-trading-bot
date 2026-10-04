"""The daily live run: check the market, decide, reconcile, trade, and record it all.

Every step's timing and outcome go into a :class:`RunRecord`, which is saved as
JSON and shown in the console's run trace.
"""

from __future__ import annotations

import datetime as dt
import time
import traceback
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import asdict, dataclass, field
from typing import Any
from zoneinfo import ZoneInfo

import pandas as pd

from algo_trading import universe
from algo_trading.broker import Broker, DuplicateOrderError, Order, OrderRequest, Side
from algo_trading.market_data import Bars, MarketData
from algo_trading.reconcile import plan_orders
from algo_trading.strategy import Params, strategy

NEW_YORK = ZoneInfo("America/New_York")
# Calendar days of prices to fetch: comfortably more than the strategy's 251 trading days.
HISTORY_DAYS = 450
# Refuse to trade if the latest completed bar is older than this many calendar days.
MAX_STALENESS_DAYS = 5


@dataclass
class Step:
    name: str
    status: str = "ok"  # ok | skipped | failed
    ms: float = 0.0
    detail: dict[str, Any] = field(default_factory=dict)


@dataclass
class RunRecord:
    trading_day: str
    started_at: str
    status: str = "ok"  # ok | skipped | failed
    finished_at: str | None = None
    dry_run: bool = False
    error: str | None = None
    steps: list[Step] = field(default_factory=list)
    decision: dict[str, Any] | None = None
    orders: list[dict[str, Any]] = field(default_factory=list)
    account: dict[str, float] | None = None
    positions: dict[str, dict[str, float]] = field(default_factory=dict)
    api_calls: list[dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class LiveConfig:
    params: Params = field(default_factory=Params)
    rebalance_threshold: float = 0.02
    cash_buffer: float = 0.01
    fetch_attempts: int = 3
    fill_timeout_s: float = 120.0
    poll_interval_s: float = 2.0
    dry_run: bool = False


class StaleDataError(Exception):
    pass


def run_live(
    market_data: MarketData,
    broker: Broker,
    now: dt.datetime,
    config: LiveConfig | None = None,
    sleep: Callable[[float], None] = time.sleep,
) -> RunRecord:
    config = config or LiveConfig()
    today = now.astimezone(NEW_YORK).date()
    record = RunRecord(
        trading_day=today.isoformat(), started_at=now.isoformat(), dry_run=config.dry_run
    )
    try:
        _run(record, market_data, broker, today, config, sleep)
    except Exception as exc:
        record.status = "failed"
        record.error = "".join(traceback.format_exception_only(exc)).strip()
    record.finished_at = dt.datetime.now(dt.UTC).isoformat()
    calls = getattr(broker, "calls", [])
    record.api_calls = [{**asdict(c), "at": c.at.isoformat()} for c in calls]
    return record


def _run(
    record: RunRecord,
    market_data: MarketData,
    broker: Broker,
    today: dt.date,
    config: LiveConfig,
    sleep: Callable[[float], None],
) -> None:
    with _step(record, "check_clock") as step:
        clock = broker.clock()
        step.detail = {"is_open": clock.is_open, "next_open": clock.next_open.isoformat()}
    # A dry run sends nothing, so it may plan while the market is closed.
    if not clock.is_open and not config.dry_run:
        step.status = record.status = "skipped"
        return

    with _step(record, "fetch_bars") as step:
        bars, attempts = _fetch(market_data, today, config, sleep)
        last = bars.dates[-1].date()
        step.detail = {
            "tickers": len(bars.tickers),
            "last_bar": last.isoformat(),
            "attempts": attempts,
        }
        if (today - last).days > MAX_STALENESS_DAYS:
            raise StaleDataError(f"latest completed bar is {last}, too old to trade on {today}")

    with _step(record, "decide") as step:
        decision = strategy(bars.close, config.params)
        record.decision = decision.to_dict()
        step.detail = {"regime": decision.regime.value, "weights": decision.weights}

    with _step(record, "reconcile") as step:
        account = broker.account()
        positions = broker.positions()
        prices = {t: float(bars.close[t].iloc[-1]) for t in universe.TRADED_TICKERS}
        plan = plan_orders(
            decision.weights,
            positions,
            account.equity,
            prices,
            today,
            config.rebalance_threshold,
            config.cash_buffer,
        )
        record.account = {"equity": account.equity, "cash": account.cash}
        record.positions = {
            s: {"qty": p.qty, "market_value": p.market_value} for s, p in positions.items()
        }
        step.detail = {"drift": plan.drift, "orders_needed": len(plan.orders)}

    if plan.in_sync or config.dry_run:
        with _step(record, "submit_orders") as step:
            step.status = "skipped"
            step.detail = {"reason": "dry run" if config.dry_run and plan.orders else "in sync"}
            record.orders = [_planned(o) for o in plan.orders]
        return

    with _step(record, "submit_orders") as step:
        sells = [o for o in plan.orders if o.side is Side.SELL]
        buys = [o for o in plan.orders if o.side is Side.BUY]
        # Sells settle first so their proceeds fund the buys.
        results = _submit_and_wait(broker, sells, config, sleep)
        results += _submit_and_wait(broker, buys, config, sleep)
        record.orders = results
        step.detail = {
            "placed": len(results),
            "filled": sum(r["status"] == "filled" for r in results),
        }
        if any(r["status"] in {"rejected", "canceled"} for r in results):
            step.status = "failed"
            raise RuntimeError("some orders were not filled")


@contextmanager
def _step(record: RunRecord, name: str) -> Iterator[Step]:
    step = Step(name)
    record.steps.append(step)
    started = time.perf_counter()
    try:
        yield step
    except Exception:
        step.status = "failed"
        raise
    finally:
        step.ms = (time.perf_counter() - started) * 1000


def _fetch(
    market_data: MarketData, today: dt.date, config: LiveConfig, sleep: Callable[[float], None]
) -> tuple[Bars, int]:
    """Completed daily bars before ``today``, retrying transient data-source failures."""
    start = today - dt.timedelta(days=HISTORY_DAYS)
    for attempt in range(1, config.fetch_attempts + 1):
        try:
            bars = market_data.get_bars(universe.ALL_TICKERS, start, today)
            break
        except Exception:
            if attempt == config.fetch_attempts:
                raise
            sleep(5.0 * attempt)
    # Today's bar is still forming while the market is open; decide on completed days only.
    completed = bars.until(pd.Timestamp(today) - pd.Timedelta(days=1))
    if len(completed.dates) < config.params.bars_needed:
        raise StaleDataError(f"only {len(completed.dates)} completed days of prices")
    return completed, attempt


def _submit_and_wait(
    broker: Broker,
    requests: list[OrderRequest],
    config: LiveConfig,
    sleep: Callable[[float], None],
) -> list[dict[str, Any]]:
    submitted: list[tuple[OrderRequest, Order | None]] = []
    for request in requests:
        try:
            submitted.append((request, broker.submit_order(request)))
        except DuplicateOrderError:
            submitted.append((request, None))  # already sent earlier today

    waited = 0.0
    results: list[dict[str, Any]] = []
    for request, order in submitted:
        if order is None:
            results.append({**_planned(request), "status": "already_submitted"})
            continue
        while not order.status.is_final and waited < config.fill_timeout_s:
            sleep(config.poll_interval_s)
            waited += config.poll_interval_s
            order = broker.get_order(order.id)
        results.append(
            {
                **_planned(request),
                "order_id": order.id,
                "status": order.status.value,
                "filled_qty": order.filled_qty,
                "filled_avg_price": order.filled_avg_price,
            }
        )
    return results


def _planned(request: OrderRequest) -> dict[str, Any]:
    return {
        "symbol": request.symbol,
        "side": request.side.value,
        "qty": request.qty,
        "client_order_id": request.client_order_id,
        "status": "planned",
    }
