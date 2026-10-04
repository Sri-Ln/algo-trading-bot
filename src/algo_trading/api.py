"""The web console's read-only API.

Every route ends in ``.json`` so that the export step can save each response
as a static file at the same path, and the console can be hosted without a
server. The OpenAPI schema FastAPI generates is the contract the console's
TypeScript types are generated from.
"""

from __future__ import annotations

import datetime as dt
from collections import Counter
from collections.abc import Callable
from functools import cache
from typing import Any

import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.routing import APIRoute
from pydantic import BaseModel

from algo_trading import universe
from algo_trading.backtest import BacktestResult
from algo_trading.console import ConsoleData, output_hash
from algo_trading.metrics import Summary, summarize_split

SCHEDULE_CRON = "35 9 * * 1-5"
SCHEDULE_TIMEZONE = "America/New_York"


class Stats(BaseModel):
    cagr: float
    volatility: float
    sharpe: float
    max_drawdown: float
    years: float


class Periods(BaseModel):
    full: Stats
    before_holdout: Stats
    holdout: Stats


class RuleCheck(BaseModel):
    rule: int
    left: str
    right: str
    lookback: int
    left_return: float
    right_return: float
    gap: float
    passed: bool


class Decision(BaseModel):
    date: str
    regime: str
    checks: list[RuleCheck]
    rsi: dict[str, float]
    weights: dict[str, float]


class Step(BaseModel):
    name: str
    status: str
    ms: float
    detail: dict[str, Any]


class OrderRecord(BaseModel):
    symbol: str
    side: str
    qty: int
    client_order_id: str
    status: str
    order_id: str | None = None
    filled_qty: int | None = None
    filled_avg_price: float | None = None


class ApiCall(BaseModel):
    at: str
    method: str
    path: str
    status: int
    elapsed_ms: float


class Position(BaseModel):
    qty: float
    market_value: float


class Account(BaseModel):
    equity: float
    cash: float


class Run(BaseModel):
    trading_day: str
    started_at: str
    finished_at: str | None
    status: str
    dry_run: bool
    error: str | None
    steps: list[Step]
    decision: Decision | None
    orders: list[OrderRecord]
    account: Account | None
    positions: dict[str, Position]
    api_calls: list[ApiCall]


class RunSummary(BaseModel):
    trading_day: str
    started_at: str
    status: str
    dry_run: bool
    duration_ms: float | None
    regime: str | None
    orders: int
    error: str | None


class RunCounts(BaseModel):
    total: int
    ok: int
    skipped: int
    failed: int


class Schedule(BaseModel):
    cron: str
    timezone: str


class Status(BaseModel):
    built_at: str
    commit: str | None
    schedule: Schedule
    latest_run: RunSummary | None
    runs: RunCounts
    first_account: Account | None  # paper account at the first run that read it
    account: Account | None  # paper account at the latest run that read it
    regime: str  # current regime: from the latest live decision, else the backtest
    weights: dict[str, float]
    regime_date: str
    data_end: str


class History(BaseModel):
    """One entry per backtest day: the regime chosen and the two signals behind it."""

    dates: list[str]
    regime: list[str]
    signal_1: list[float]
    signal_2: list[float]
    bond_lookback: int
    long_bond_lookback: int
    holdout_start: str


class TradeDay(BaseModel):
    date: str  # day the orders fill, at the open
    turnover: float  # sum of |weight change|: 2.0 is a full switch


class Backtest(BaseModel):
    run_id: str
    cost_bps: float
    rebalance_threshold: float
    bond_lookback: int
    long_bond_lookback: int
    risk_on_rsi_window: int
    rising_rates_rsi_window: int
    holdout_start: str
    dates: list[str]
    equity: list[float]  # growth of $1, after costs at ``cost_bps``
    benchmark: list[float]  # growth of $1 in SPY
    trades: list[TradeDay]
    strategy: Periods
    spy: Periods
    trades_per_year: float
    cost_drag: float
    seconds: float


class CostPoint(BaseModel):
    cost_bps: float
    periods: Periods
    cost_drag: float


class Costs(BaseModel):
    baseline_cost_bps: float
    points: list[CostPoint]


class SweepCell(BaseModel):
    bond_lookback: int
    risk_on_rsi_window: int
    periods: Periods
    trades_per_year: float


class Sweep(BaseModel):
    cost_bps: float
    baseline_bond_lookback: int
    baseline_risk_on_rsi_window: int
    bond_lookbacks: list[int]
    risk_on_rsi_windows: list[int]
    cells: list[SweepCell]
    seconds: float


class Fund(BaseModel):
    ticker: str
    role: str  # signal | risk_on | rising_rates | falling_rates | benchmark


class Checks(BaseModel):
    passed: int
    failed: int
    coverage: float | None


class Endpoint(BaseModel):
    path: str
    summary: str
    files: int


class System(BaseModel):
    built_at: str
    commit: str | None
    schedule: Schedule
    funds: list[Fund]
    data_source: str
    data_start: str
    data_end: str
    rows: int
    output_hash: str
    checks: Checks | None
    endpoints: list[Endpoint]


def create_app(load: Callable[[], ConsoleData]) -> FastAPI:
    """The API over the data ``load`` returns.

    ``load`` runs on the first request, so building the app (for example to
    write its OpenAPI schema) needs no prices.
    """
    app = FastAPI(
        title="algo-trading console API",
        version="1",
        description="Read-only data behind the web console, published as static JSON files.",
    )
    get = cache(load)
    schedule = Schedule(cron=SCHEDULE_CRON, timezone=SCHEDULE_TIMEZONE)

    @app.get("/api/status.json", summary="Health, latest run and current regime")
    def status() -> Status:
        data = get()
        result = data.backtest
        latest = data.runs[-1] if data.runs else None
        with_account = [r for r in data.runs if r.get("account")]
        live_decision = next((r["decision"] for r in reversed(data.runs) if r["decision"]), None)
        decision = live_decision or result.decisions[-1].to_dict()
        counts = Counter(r["status"] for r in data.runs)
        return Status(
            built_at=data.built_at,
            commit=data.commit,
            schedule=schedule,
            latest_run=_summary(latest) if latest else None,
            runs=RunCounts(
                total=len(data.runs),
                ok=counts["ok"],
                skipped=counts["skipped"],
                failed=counts["failed"],
            ),
            first_account=with_account[0]["account"] if with_account else None,
            account=with_account[-1]["account"] if with_account else None,
            regime=decision["regime"],
            weights=decision["weights"],
            regime_date=decision["date"],
            data_end=data.bars.dates[-1].date().isoformat(),
        )

    @app.get("/api/runs.json", summary="Every live run, newest first")
    def run_list() -> list[RunSummary]:
        data = get()
        return [_summary(r) for r in reversed(data.runs)]

    @app.get("/api/runs/{day}.json", summary="One live run with its step trace and orders")
    def run(day: str) -> Run:
        runs = {r["trading_day"]: r for r in get().runs}
        if day not in runs:
            raise HTTPException(404, f"no run on {day}")
        return Run.model_validate(runs[day])

    @app.get("/api/history.json", summary="Regime and both signals for every backtest day")
    def history() -> History:
        data = get()
        result = data.backtest
        return History(
            dates=_days(result),
            regime=[d.regime.value for d in result.decisions],
            signal_1=_floats(data.signal_1),
            signal_2=_floats(data.signal_2),
            bond_lookback=result.config.params.bond_lookback,
            long_bond_lookback=result.config.params.long_bond_lookback,
            holdout_start=data.holdout.date().isoformat(),
        )

    @app.get("/api/decisions/{year}.json", summary="strategy() output for each day of a year")
    def decisions(year: int) -> dict[str, Decision]:
        result = get().backtest
        found = {
            d.date.date().isoformat(): Decision.model_validate(d.to_dict())
            for d in result.decisions
            if d.date.year == year
        }
        if not found:
            raise HTTPException(404, f"no decisions in {year}")
        return found

    @app.get("/api/backtest.json", summary="Equity curves, trades and statistics")
    def backtest() -> Backtest:
        data = get()
        result, holdout = data.backtest, data.holdout
        p, years = result.config.params, (len(result.equity) - 1) / 252
        return Backtest(
            run_id=data.run_id,
            cost_bps=result.config.cost_bps,
            rebalance_threshold=result.config.rebalance_threshold,
            bond_lookback=p.bond_lookback,
            long_bond_lookback=p.long_bond_lookback,
            risk_on_rsi_window=p.risk_on_rsi_window,
            rising_rates_rsi_window=p.rising_rates_rsi_window,
            holdout_start=holdout.date().isoformat(),
            dates=_days(result),
            equity=_floats(result.equity),
            benchmark=_floats(result.benchmark),
            trades=[
                TradeDay(date=t.date.date().isoformat(), turnover=t.turnover) for t in result.trades
            ],
            strategy=_periods(summarize_split(result.equity, result.cash_returns, holdout)),
            spy=_periods(summarize_split(result.benchmark, result.cash_returns, holdout)),
            trades_per_year=len(result.trades) / years,
            cost_drag=sum(t.cost for t in result.trades) / years,
            seconds=data.backtest_seconds,
        )

    @app.get("/api/costs.json", summary="Statistics at every trading cost from 0 to 25 bps")
    def costs() -> Costs:
        data = get()
        result = data.backtest
        return Costs(
            baseline_cost_bps=result.config.cost_bps,
            points=[
                CostPoint(cost_bps=c.cost_bps, periods=_periods(c.periods), cost_drag=c.cost_drag)
                for c in data.costs
            ],
        )

    @app.get("/api/sweep.json", summary="Backtests with nearby parameter settings")
    def sweep() -> Sweep:
        data = get()
        result = data.backtest
        p = result.config.params
        return Sweep(
            cost_bps=result.config.cost_bps,
            baseline_bond_lookback=p.bond_lookback,
            baseline_risk_on_rsi_window=p.risk_on_rsi_window,
            bond_lookbacks=sorted({c.bond_lookback for c in data.sweep}),
            risk_on_rsi_windows=sorted({c.risk_on_rsi_window for c in data.sweep}),
            cells=[
                SweepCell(
                    bond_lookback=c.bond_lookback,
                    risk_on_rsi_window=c.risk_on_rsi_window,
                    periods=_periods(c.periods),
                    trades_per_year=c.trades_per_year,
                )
                for c in data.sweep
            ],
            seconds=data.sweep_seconds,
        )

    @app.get("/api/system.json", summary="Build, data, test and endpoint facts")
    def system() -> System:
        data = get()
        result, bars = data.backtest, data.bars
        checks = data.checks
        return System(
            built_at=data.built_at,
            commit=data.commit,
            schedule=schedule,
            funds=_funds(),
            data_source="Yahoo Finance via yfinance",
            data_start=bars.dates[0].date().isoformat(),
            data_end=bars.dates[-1].date().isoformat(),
            rows=int(bars.close.size),
            output_hash=output_hash(result),
            checks=Checks(**vars(checks)) if checks else None,
            endpoints=[
                Endpoint(path=path, summary=summary, files=len(expand(path, data)))
                for path, summary in route_summaries(app)
            ],
        )

    return app


def route_summaries(app: FastAPI) -> list[tuple[str, str]]:
    """Path template and summary of each API route, in definition order."""
    return [
        (r.path, r.summary or "")
        for r in app.routes
        if isinstance(r, APIRoute) and r.path.startswith("/api/")
    ]


def expand(path: str, data: ConsoleData) -> list[str]:
    """Every concrete path for a route template, given the data being published."""
    if "{day}" in path:
        return [path.replace("{day}", day) for day in data.run_days]
    if "{year}" in path:
        return [path.replace("{year}", str(year)) for year in data.years]
    if "{" in path:
        raise ValueError(f"no values known for the parameters in {path}")
    return [path]


def _summary(record: dict[str, Any]) -> RunSummary:
    started, finished = record["started_at"], record.get("finished_at")
    duration = (
        (dt.datetime.fromisoformat(finished) - dt.datetime.fromisoformat(started)).total_seconds()
        * 1000
        if finished
        else None
    )
    decision = record.get("decision")
    return RunSummary(
        trading_day=record["trading_day"],
        started_at=started,
        status=record["status"],
        dry_run=record.get("dry_run", False),
        duration_ms=duration,
        regime=decision["regime"] if decision else None,
        orders=len(record.get("orders", [])),
        error=record.get("error"),
    )


def _days(result: BacktestResult) -> list[str]:
    return [d.date().isoformat() for d in result.equity.index]


def _periods(periods: dict[str, Summary]) -> Periods:
    return Periods(**{name: Stats(**s.to_dict()) for name, s in periods.items()})


def _floats(series: pd.Series) -> list[float]:
    return [float(v) for v in series.fillna(0.0)]


def _funds() -> list[Fund]:
    roles = {
        "signal": universe.SIGNAL_TICKERS,
        "risk_on": universe.RISK_ON,
        "rising_rates": (universe.DOLLAR, *universe.RISING_RATES_HEDGES),
        "falling_rates": universe.FALLING_RATES_BASKET,
        "benchmark": (universe.BENCHMARK,),
    }
    return [Fund(ticker=t, role=role) for role, tickers in roles.items() for t in tickers]
