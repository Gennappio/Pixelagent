from __future__ import annotations

import json
import sqlite3
import uuid

from server.events.emitter import utc_timestamp
from server.workflow.models import Run, RunStatus, RunSummary, Workflow


def _summary(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "workflow_id": row["workflow_id"],
        "status": row["status"],
        "input": row["input"],
        "created_at": row["created_at"],
        "finished_at": row["finished_at"],
    }


class RunRepository:
    def __init__(self, connection: sqlite3.Connection) -> None:
        self._db = connection

    def create(self, workflow: Workflow, run_input: str) -> Run:
        # Run ids are minted here, never by the UI.
        run = Run(
            id=f"run_{uuid.uuid4().hex[:12]}",
            workflow_id=workflow.id,
            status=RunStatus.RUNNING,
            input=run_input,
            created_at=utc_timestamp(),
            workflow=workflow,
        )
        self._db.execute(
            "INSERT INTO runs (id, workflow_id, status, input, workflow_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (
                run.id,
                run.workflow_id,
                run.status.value,
                run.input,
                json.dumps(workflow.to_wire(), ensure_ascii=False),
                run.created_at,
            ),
        )
        self._db.commit()
        return run

    def finish(self, run_id: str, status: RunStatus) -> None:
        self._db.execute(
            "UPDATE runs SET status = ?, finished_at = ? WHERE id = ?", (status.value, utc_timestamp(), run_id)
        )
        self._db.commit()

    def interrupt_running(self) -> None:
        """Runs still marked running at startup were cut short by a restart."""
        self._db.execute(
            "UPDATE runs SET status = ? WHERE status = ?", (RunStatus.INTERRUPTED.value, RunStatus.RUNNING.value)
        )
        self._db.commit()

    def get(self, run_id: str) -> Run | None:
        row = self._db.execute("SELECT * FROM runs WHERE id = ?", (run_id,)).fetchone()
        if row is None:
            return None
        return Run(**_summary(row), workflow=Workflow.model_validate(json.loads(row["workflow_json"])))

    def list(self, workflow_id: str | None = None) -> list[RunSummary]:
        query = "SELECT id, workflow_id, status, input, created_at, finished_at FROM runs"
        params: tuple = ()
        if workflow_id is not None:
            query += " WHERE workflow_id = ?"
            params = (workflow_id,)
        rows = self._db.execute(query + " ORDER BY created_at DESC, rowid DESC", params).fetchall()
        return [RunSummary(**_summary(row)) for row in rows]
