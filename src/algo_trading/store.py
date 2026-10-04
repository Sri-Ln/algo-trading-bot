"""Persist live run records as JSON files, which the web console reads."""

from __future__ import annotations

import json
from pathlib import Path

from algo_trading.live import RunRecord

LIVE_DIR = Path("data/live")


def save_run(record: RunRecord, root: Path = LIVE_DIR) -> Path:
    """Write the run to ``runs/<trading day>.json`` and ``latest.json``.

    A rerun on the same day replaces that day's file.
    """
    payload = json.dumps(record.to_dict(), indent=2, sort_keys=True) + "\n"
    path = root / "runs" / f"{record.trading_day}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(payload)
    (root / "latest.json").write_text(payload)
    return path
