"""Persist run records and backtest results as JSON files, which the web console reads."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from algo_trading.live import RunRecord

LIVE_DIR = Path("data/live")
BACKTEST_DIR = Path("data/backtest")


def save_json(payload: dict[str, Any], path: Path) -> Path:
    """Write ``payload`` with sorted keys, so reruns that change nothing leave no diff."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")
    return path


def save_run(record: RunRecord, root: Path = LIVE_DIR) -> Path:
    """Write the run to ``runs/<trading day>.json`` and ``latest.json``.

    A rerun on the same day replaces that day's file.
    """
    payload = record.to_dict()
    save_json(payload, root / "latest.json")
    return save_json(payload, root / "runs" / f"{record.trading_day}.json")


def load_runs(root: Path = LIVE_DIR) -> list[dict[str, Any]]:
    """Every saved run record, oldest first."""
    return [json.loads(p.read_text()) for p in sorted((root / "runs").glob("*.json"))]
