from __future__ import annotations

import sqlite3
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS workflows (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    input TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agents (
    workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    ordinal INTEGER NOT NULL,
    definition_json TEXT NOT NULL,
    PRIMARY KEY (workflow_id, id)
);

CREATE TABLE IF NOT EXISTS workflow_nodes (
    workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    ordinal INTEGER NOT NULL,
    type TEXT NOT NULL,
    agent_id TEXT,
    tool TEXT,
    x REAL NOT NULL,
    y REAL NOT NULL,
    PRIMARY KEY (workflow_id, id)
);

CREATE TABLE IF NOT EXISTS workflow_edges (
    workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    ordinal INTEGER NOT NULL,
    source TEXT NOT NULL,
    target TEXT NOT NULL,
    PRIMARY KEY (workflow_id, id)
);

CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL,
    status TEXT NOT NULL,
    input TEXT NOT NULL,
    -- Snapshot of the workflow as executed, so a run stays replayable after edits.
    workflow_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    finished_at TEXT
);

CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id),
    sequence INTEGER NOT NULL,
    timestamp TEXT NOT NULL,
    type TEXT NOT NULL,
    actor_id TEXT,
    target_id TEXT,
    payload_json TEXT NOT NULL,
    UNIQUE (run_id, sequence)
);

-- The event log is append-only: history is never rewritten.
CREATE TRIGGER IF NOT EXISTS events_no_update BEFORE UPDATE ON events
BEGIN
    SELECT RAISE(ABORT, 'events are append-only');
END;

CREATE TRIGGER IF NOT EXISTS events_no_delete BEFORE DELETE ON events
BEGIN
    SELECT RAISE(ABORT, 'events are append-only');
END;
"""


def connect(path: str | Path) -> sqlite3.Connection:
    """Open (and initialise) the database. Use ":memory:" for tests."""
    if str(path) != ":memory:":
        Path(path).parent.mkdir(parents=True, exist_ok=True)
    # The app touches the connection only from the event loop thread; the flag is
    # off because test clients drive that loop from a worker thread.
    connection = sqlite3.connect(str(path), check_same_thread=False)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.executescript(SCHEMA)
    connection.commit()
    return connection
