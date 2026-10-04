import datetime as dt
import json
from pathlib import Path

import pandas as pd
import pytest

from algo_trading import cli
from algo_trading.broker import FakeBroker
from algo_trading.cli import main
from algo_trading.market_data import Bars
from tests.conftest import FakeMarketData, make_bars
from tests.test_strategy import closes as universe_closes


def steady_bars() -> Bars:
    # 12 copies of a steady risk-on history reach past the holdout start.
    longer = pd.concat([universe_closes(AGG=0.001)] * 12, ignore_index=True)
    longer.index = pd.bdate_range("2011-10-03", periods=len(longer), name="date")
    return Bars(open=longer.shift(1).fillna(longer), close=longer)


def test_backtest_command_prints_a_report(capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["backtest", "--cost-bps", "10"], source=FakeMarketData(steady_bars())) == 0

    out = capsys.readouterr().out
    assert "cost 10 bps" in out
    assert "holdout" in out
    assert "trades per year" in out


def test_sweep_command_saves_grid_and_cost_curve(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(cli, "BOND_LOOKBACKS", (50, 60))
    monkeypatch.setattr(cli, "RISK_ON_RSI_WINDOWS", (10,))
    assert main(["sweep"], source=FakeMarketData(steady_bars()), backtest_dir=tmp_path) == 0

    sweep = json.loads((tmp_path / "sweep.json").read_text())
    costs = json.loads((tmp_path / "costs.json").read_text())
    assert len(sweep["cells"]) == 2
    assert sweep["bond_lookbacks"] == [50, 60]
    assert sweep["baseline"] == {"bond_lookback": 60, "risk_on_rsi_window": 10}
    assert sweep["holdout_start"] == costs["holdout_start"] == "2023-01-03"
    assert [p["cost_bps"] for p in costs["points"]] == list(range(26))
    out = capsys.readouterr().out
    assert "Sharpe holdout" in out
    assert "  25bp" in out


def test_live_command_saves_the_run_and_reports_status(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    broker = FakeBroker(cash=0.0, prices={}, now=dt.datetime.now(dt.UTC), is_open=False)
    code = main(
        ["live"],
        source=FakeMarketData(make_bars({"SPY": [1.0, 2.0]})),
        broker=broker,
        live_dir=tmp_path,
    )
    assert code == 0
    assert "skipped" in capsys.readouterr().out
    assert (tmp_path / "latest.json").exists()
