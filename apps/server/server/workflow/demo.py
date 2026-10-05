"""The deterministic demo workflow. It needs no API keys and must never break."""

from __future__ import annotations

import json
from pathlib import Path

from server.workflow.models import Workflow

DEMO_WORKFLOW_ID = "demo"

# <repo>/workflows: one JSON file per workflow, including the demo.
WORKFLOWS_DIR = Path(__file__).resolve().parents[4] / "workflows"


def demo_workflow() -> Workflow:
    return Workflow.model_validate(json.loads((WORKFLOWS_DIR / f"{DEMO_WORKFLOW_ID}.json").read_text("utf-8")))
