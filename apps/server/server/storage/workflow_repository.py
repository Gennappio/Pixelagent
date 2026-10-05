from __future__ import annotations

import json
import sqlite3

from server.events.emitter import utc_timestamp
from server.workflow.models import Workflow, WorkflowSummary


class WorkflowRepository:
    def __init__(self, connection: sqlite3.Connection) -> None:
        self._db = connection

    def save(self, workflow: Workflow) -> None:
        """Insert or fully replace a workflow."""
        now = utc_timestamp()
        with self._db:
            self._db.execute(
                "INSERT INTO workflows (id, name, input, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
                " ON CONFLICT(id) DO UPDATE SET name = excluded.name, input = excluded.input,"
                " updated_at = excluded.updated_at",
                (workflow.id, workflow.name, workflow.input, now, now),
            )
            for table in ("agents", "workflow_nodes", "workflow_edges"):
                self._db.execute(f"DELETE FROM {table} WHERE workflow_id = ?", (workflow.id,))
            self._db.executemany(
                "INSERT INTO agents (workflow_id, id, ordinal, definition_json) VALUES (?, ?, ?, ?)",
                [
                    (workflow.id, agent.id, i, json.dumps(agent.to_wire(), ensure_ascii=False))
                    for i, agent in enumerate(workflow.agents)
                ],
            )
            self._db.executemany(
                "INSERT INTO workflow_nodes (workflow_id, id, ordinal, type, agent_id, tool, x, y)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                [
                    (workflow.id, n.id, i, n.type.value, n.agent_id, n.tool, n.position.x, n.position.y)
                    for i, n in enumerate(workflow.nodes)
                ],
            )
            self._db.executemany(
                "INSERT INTO workflow_edges (workflow_id, id, ordinal, source, target) VALUES (?, ?, ?, ?, ?)",
                [(workflow.id, e.id, i, e.source, e.target) for i, e in enumerate(workflow.edges)],
            )

    def get(self, workflow_id: str) -> Workflow | None:
        row = self._db.execute("SELECT * FROM workflows WHERE id = ?", (workflow_id,)).fetchone()
        if row is None:
            return None

        def rows(table: str) -> list[sqlite3.Row]:
            return self._db.execute(
                f"SELECT * FROM {table} WHERE workflow_id = ? ORDER BY ordinal", (workflow_id,)
            ).fetchall()

        return Workflow.model_validate(
            {
                "id": row["id"],
                "name": row["name"],
                "input": row["input"],
                "agents": [json.loads(r["definition_json"]) for r in rows("agents")],
                "nodes": [
                    {
                        "id": r["id"],
                        "type": r["type"],
                        "agentId": r["agent_id"],
                        "tool": r["tool"],
                        "position": {"x": r["x"], "y": r["y"]},
                    }
                    for r in rows("workflow_nodes")
                ],
                "edges": [{"id": r["id"], "source": r["source"], "target": r["target"]} for r in rows("workflow_edges")],
            }
        )

    def list(self) -> list[WorkflowSummary]:
        rows = self._db.execute("SELECT id, name, updated_at FROM workflows ORDER BY created_at").fetchall()
        return [WorkflowSummary(id=r["id"], name=r["name"], updated_at=r["updated_at"]) for r in rows]
