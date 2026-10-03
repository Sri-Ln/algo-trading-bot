import datetime as dt
from pathlib import Path

import pandas as pd
import pytest

from algo_trading.broker import FakeBroker
from algo_trading.cli import main
from algo_trading.market_data import Bars
from tests.conftest import FakeMarketData, make_bars
from tests.test_strategy import closes as universe_closes


def test_backtest_command_prints_a_report(capsys: pytest.CaptureFixture[str]) -> None:
    # 12 copies of a steady risk-on history reach past the holdout start.
    longer = pd.concat([universe_closes(AGG=0.001)] * 12, ignore_index=True)
    longer.index = pd.bdate_range("2011-10-03", periods=len(longer), name="date")
    bars = Bars(open=longer.shift(1).fillna(longer), close=longer)

    assert main(["backtest", "--cost-bps", "10"], source=FakeMarketData(bars)) == 0

    out = capsys.readouterr().out
    assert "cost 10 bps" in out
    assert "holdout" in out
    assert "trades per year" in out


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
