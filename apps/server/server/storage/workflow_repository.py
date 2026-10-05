from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone
from pathlib import Path

from server.workflow.models import Workflow, WorkflowSummary

logger = logging.getLogger(__name__)

_SAFE_ID = re.compile(r"^[A-Za-z0-9_-]+$")


class WorkflowRepository:
    """Workflows live as `<id>.json` files in one folder, so they can be read, edited and versioned."""

    def __init__(self, directory: str | Path) -> None:
        self._dir = Path(directory)
        self._dir.mkdir(parents=True, exist_ok=True)

    def _path(self, workflow_id: str) -> Path | None:
        # Ids come from URLs: never let one name a file outside the folder.
        return self._dir / f"{workflow_id}.json" if _SAFE_ID.match(workflow_id) else None

    def save(self, workflow: Workflow) -> None:
        """Create or fully replace a workflow file."""
        path = self._path(workflow.id)
        if path is None:
            raise ValueError(f"invalid workflow id {workflow.id!r}")
        temporary = path.with_suffix(".json.tmp")
        temporary.write_text(json.dumps(workflow.to_wire(), indent=2, ensure_ascii=False) + "\n", "utf-8")
        temporary.replace(path)

    def get(self, workflow_id: str) -> Workflow | None:
        path = self._path(workflow_id)
        if path is None or not path.is_file():
            return None
        # The file name is the identity, whatever a hand-edited file claims.
        return Workflow.model_validate({**json.loads(path.read_text("utf-8")), "id": workflow_id})

    def list(self) -> list[WorkflowSummary]:
        summaries = []
        for path in sorted(self._dir.glob("*.json")):
            try:
                workflow = self.get(path.stem)
            except ValueError as exc:  # malformed JSON or schema: skip it, keep the rest usable
                logger.warning("ignoring invalid workflow file %s: %s", path, exc)
                continue
            if workflow is None:
                continue
            modified = datetime.fromtimestamp(path.stat().st_mtime, timezone.utc)
            summaries.append(
                WorkflowSummary(
                    id=workflow.id,
                    name=workflow.name,
                    updated_at=modified.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
                )
            )
        return summaries
