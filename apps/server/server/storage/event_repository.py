from __future__ import annotations

import json
import sqlite3

from server.events.models import AgentEvent


class EventRepository:
    """Append-only access to the event log."""

    def __init__(self, connection: sqlite3.Connection) -> None:
        self._db = connection

    def append(self, event: AgentEvent) -> None:
        self._db.execute(
            "INSERT INTO events (id, run_id, sequence, timestamp, type, actor_id, target_id, payload_json)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (
                event.id,
                event.run_id,
                event.sequence,
                event.timestamp,
                event.type.value,
                event.actor_id,
                event.target_id,
                json.dumps(event.payload, ensure_ascii=False),
            ),
        )
        self._db.commit()

    def list(self, run_id: str, after: int = 0) -> list[AgentEvent]:
        rows = self._db.execute(
            "SELECT * FROM events WHERE run_id = ? AND sequence > ? ORDER BY sequence",
            (run_id, after),
        ).fetchall()
        return [
            AgentEvent(
                id=row["id"],
                run_id=row["run_id"],
                sequence=row["sequence"],
                timestamp=row["timestamp"],
                type=row["type"],
                actor_id=row["actor_id"],
                target_id=row["target_id"],
                payload=json.loads(row["payload_json"]),
            )
            for row in rows
        ]

    def last_sequence(self, run_id: str) -> int:
        row = self._db.execute(
            "SELECT COALESCE(MAX(sequence), 0) AS last FROM events WHERE run_id = ?", (run_id,)
        ).fetchone()
        return int(row["last"])
