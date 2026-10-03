import json
from pathlib import Path

from algo_trading.live import RunRecord, Step
from algo_trading.store import save_run


def test_writes_day_file_and_latest(tmp_path: Path) -> None:
    record = RunRecord(trading_day="2026-10-05", started_at="t", steps=[Step("check_clock")])
    path = save_run(record, tmp_path)
    assert path == tmp_path / "runs" / "2026-10-05.json"
    assert json.loads(path.read_text())["steps"][0]["name"] == "check_clock"
    assert (tmp_path / "latest.json").read_text() == path.read_text()


def test_rerun_replaces_the_days_file(tmp_path: Path) -> None:
    save_run(RunRecord(trading_day="2026-10-05", started_at="t", status="failed"), tmp_path)
    save_run(RunRecord(trading_day="2026-10-05", started_at="t2"), tmp_path)
    files = list((tmp_path / "runs").iterdir())
    assert len(files) == 1
    assert json.loads(files[0].read_text())["status"] == "ok"
