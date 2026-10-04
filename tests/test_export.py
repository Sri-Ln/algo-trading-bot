import json
from pathlib import Path

import pytest

from algo_trading import cli
from algo_trading.api import create_app, expand, route_summaries
from algo_trading.cli import main
from algo_trading.console import ChecksReport, ConsoleData
from algo_trading.export import export_static, read_checks
from tests.conftest import FakeMarketData
from tests.test_api import RUNS, make_data
from tests.test_cli import steady_bars


@pytest.fixture(scope="module")
def data() -> ConsoleData:
    return make_data(RUNS)


def test_export_writes_every_route_and_the_schema(tmp_path: Path, data: ConsoleData) -> None:
    app = create_app(lambda: data)
    written = export_static(app, data, tmp_path)
    expected = {p for template, _ in route_summaries(app) for p in expand(template, data)}
    assert {"/" + str(p.relative_to(tmp_path)) for p in written} == expected | {"/api/openapi.json"}
    assert json.loads((tmp_path / "api/runs/2022-08-31.json").read_text())["status"] == "skipped"


def test_read_checks_counts_tests_and_coverage(tmp_path: Path) -> None:
    junit = tmp_path / "junit.xml"
    junit.write_text(
        '<testsuites><testsuite tests="12" failures="1" errors="1" skipped="2"/></testsuites>'
    )
    coverage = tmp_path / "coverage.json"
    coverage.write_text(json.dumps({"totals": {"percent_covered": 88.25}}))
    assert read_checks(junit, coverage) == ChecksReport(passed=8, failed=2, coverage=88.25)


def test_export_command_writes_the_site(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(cli, "BOND_LOOKBACKS", (60,))
    monkeypatch.setattr(cli, "RISK_ON_RSI_WINDOWS", (10,))
    out, live = tmp_path / "site", tmp_path / "live"
    args = ["export", "--out", str(out), "--commit", "abc123"]
    assert main(args, source=FakeMarketData(steady_bars()), live_dir=live) == 0
    status = json.loads((out / "api/status.json").read_text())
    assert status["commit"] == "abc123"
    assert status["latest_run"] is None
    assert (out / "api/openapi.json").exists()


def test_openapi_command_writes_the_schema(tmp_path: Path) -> None:
    assert main(["openapi", str(tmp_path / "openapi.json")]) == 0
    schema = json.loads((tmp_path / "openapi.json").read_text())
    assert schema["info"]["title"] == "algo-trading console API"
