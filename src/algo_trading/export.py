"""Publish the console API as static files: one JSON file per concrete route."""

from __future__ import annotations

import json
import warnings
import xml.etree.ElementTree as ET
from pathlib import Path

from fastapi import FastAPI
from starlette.exceptions import StarletteDeprecationWarning

from algo_trading.api import expand, route_summaries
from algo_trading.console import ChecksReport, ConsoleData

# Starlette's test client warns that it will move off httpx; it works as is.
with warnings.catch_warnings():
    warnings.simplefilter("ignore", StarletteDeprecationWarning)
    from fastapi.testclient import TestClient


def export_static(app: FastAPI, data: ConsoleData, out: Path) -> list[Path]:
    """Request every route and save each response under ``out`` at the route's path.

    Also writes the OpenAPI schema to ``api/openapi.json``.
    """
    client = TestClient(app)
    written = []
    for template, _ in route_summaries(app):
        for path in expand(template, data):
            response = client.get(path)
            response.raise_for_status()
            written.append(_write(out / path.lstrip("/"), response.content))
    written.append(write_openapi(app, out / "api" / "openapi.json"))
    return written


def write_openapi(app: FastAPI, path: Path) -> Path:
    return _write(path, (json.dumps(app.openapi(), indent=2, sort_keys=True) + "\n").encode())


def read_checks(junit_xml: Path, coverage_json: Path | None = None) -> ChecksReport:
    """Test counts from a pytest JUnit report, and line coverage from coverage.py's JSON."""
    root = ET.parse(junit_xml).getroot()
    suites = [root] if root.tag == "testsuite" else list(root.iter("testsuite"))
    total = sum(int(s.get("tests", 0)) for s in suites)
    failed = sum(int(s.get("failures", 0)) + int(s.get("errors", 0)) for s in suites)
    skipped = sum(int(s.get("skipped", 0)) for s in suites)
    coverage = None
    if coverage_json is not None:
        coverage = float(json.loads(coverage_json.read_text())["totals"]["percent_covered"])
    return ChecksReport(passed=total - failed - skipped, failed=failed, coverage=coverage)


def _write(path: Path, content: bytes) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    return path
