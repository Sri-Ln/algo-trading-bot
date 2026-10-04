import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from algo_trading import universe
from algo_trading.api import create_app
from algo_trading.backtest import BacktestConfig
from algo_trading.console import ChecksReport, ConsoleData, build_console_data
from algo_trading.live import RunRecord, Step
from algo_trading.market_data import Bars
from algo_trading.metrics import summarize
from algo_trading.strategy import Params

CONFIG = BacktestConfig(Params(bond_lookback=10, long_bond_lookback=5, rsi_history=20))


def make_data(runs: list[RunRecord]) -> ConsoleData:
    rng = np.random.default_rng(3)
    days = 320
    walk = {t: 100 * np.cumprod(1 + rng.normal(0, 0.02, days)) for t in universe.ALL_TICKERS}
    close = pd.DataFrame(walk, index=pd.bdate_range("2021-06-01", periods=days, name="date"))
    bars = Bars(open=close.shift(1).fillna(close), close=close)
    return build_console_data(
        bars,
        CONFIG,
        pd.Timestamp("2022-06-01"),
        [r.to_dict() for r in runs],
        built_at="2022-09-01T12:00:00+00:00",
        commit="abc123",
        checks=ChecksReport(passed=10, failed=0, coverage=91.5),
        bond_lookbacks=(8, 10),
        risk_on_rsi_windows=(10,),
    )


def run_record(day: str, status: str = "ok", regime: str | None = None) -> RunRecord:
    decision = None
    if regime:
        decision = {"date": day, "regime": regime, "checks": [], "rsi": {}, "weights": {"UUP": 1.0}}
    return RunRecord(
        trading_day=day,
        started_at=f"{day}T13:35:00+00:00",
        finished_at=f"{day}T13:35:02.5+00:00",
        status=status,
        steps=[Step("check_clock", detail={"is_open": True})],
        decision=decision,
        account={"equity": 101_000.0, "cash": 50.0},
    )


RUNS = [
    run_record("2022-08-30", regime="risk_on"),
    run_record("2022-08-31", status="skipped"),
    run_record("2022-09-01", regime="risk_off_falling"),
]


@pytest.fixture(scope="module")
def data() -> ConsoleData:
    return make_data(RUNS)


@pytest.fixture(scope="module")
def client(data: ConsoleData) -> TestClient:
    return TestClient(create_app(lambda: data))


def test_status_reports_the_latest_run_and_live_regime(client: TestClient) -> None:
    status = client.get("/api/status.json").json()
    assert status["latest_run"]["trading_day"] == "2022-09-01"
    assert status["latest_run"]["duration_ms"] == pytest.approx(2500)
    assert status["runs"] == {"total": 3, "ok": 2, "skipped": 1, "failed": 0}
    assert status["regime"] == "risk_off_falling"
    assert status["commit"] == "abc123"


def test_status_without_runs_uses_the_backtest_decision() -> None:
    data = make_data([])
    status = TestClient(create_app(lambda: data)).get("/api/status.json").json()
    assert status["latest_run"] is None
    assert status["regime"] == data.backtest.decisions[-1].regime.value
    assert status["account"] is None


def test_runs_are_listed_newest_first_and_served_one_by_one(client: TestClient) -> None:
    days = [r["trading_day"] for r in client.get("/api/runs.json").json()]
    assert days == ["2022-09-01", "2022-08-31", "2022-08-30"]
    run = client.get("/api/runs/2022-08-30.json").json()
    assert run["decision"]["regime"] == "risk_on"
    assert client.get("/api/runs/2022-01-01.json").status_code == 404


def test_history_lines_up_with_the_backtest(client: TestClient, data: ConsoleData) -> None:
    history = client.get("/api/history.json").json()
    backtest = client.get("/api/backtest.json").json()
    assert history["dates"] == backtest["dates"]
    assert len(history["signal_2"]) == len(history["dates"])
    day = data.backtest.decisions[-1]
    assert history["signal_1"][-1] == pytest.approx(day.checks[0].gap)


def test_decisions_are_split_by_year(client: TestClient, data: ConsoleData) -> None:
    year = client.get("/api/decisions/2022.json").json()
    assert all(d.startswith("2022-") for d in year)
    assert year["2022-06-01"]["weights"]
    assert client.get("/api/decisions/1999.json").status_code == 404


def test_exported_trades_reprice_to_the_published_cost_curve(client: TestClient) -> None:
    # The console re-prices the curve for its cost slider the same way.
    backtest = client.get("/api/backtest.json").json()
    costs = client.get("/api/costs.json").json()
    base = backtest["cost_bps"] / 10_000
    factor = dict.fromkeys(backtest["dates"], 1.0)
    for t in backtest["trades"]:
        factor[t["date"]] = (1 - t["turnover"] * 0.0025) / (1 - t["turnover"] * base)
    equity = pd.Series(backtest["equity"], index=pd.to_datetime(backtest["dates"]))
    repriced = equity * pd.Series(list(factor.values()), index=equity.index).cumprod()
    point = next(p for p in costs["points"] if p["cost_bps"] == 25)
    assert summarize(repriced).cagr == pytest.approx(point["periods"]["full"]["cagr"])


def test_sweep_marks_the_published_settings(client: TestClient) -> None:
    sweep = client.get("/api/sweep.json").json()
    assert sweep["bond_lookbacks"] == [8, 10]
    assert sweep["baseline_bond_lookback"] == 10
    assert len(sweep["cells"]) == 2


def test_system_lists_every_endpoint_and_test_results(client: TestClient) -> None:
    system = client.get("/api/system.json").json()
    files = {e["path"]: e["files"] for e in system["endpoints"]}
    assert files["/api/runs/{day}.json"] == 3
    assert files["/api/decisions/{year}.json"] == 2
    assert system["checks"] == {"passed": 10, "failed": 0, "coverage": 91.5}
    assert len(system["funds"]) == len(universe.ALL_TICKERS)


def test_schema_needs_no_data() -> None:
    def fail() -> ConsoleData:
        raise AssertionError("data should not be loaded")

    schema = create_app(fail).openapi()
    assert "/api/backtest.json" in schema["paths"]
    assert "Backtest" in schema["components"]["schemas"]
