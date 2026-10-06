"""Logs shared with the web client, in <repo>/tests/fixtures.

Each file has the shape of a run export (so it can also be opened in the UI
with Runs → Open file) plus two things derived from its events: `registry`, the
documents the whole log folds to, and `places`, where every document is after
each event. The web tests fold the same events with their own implementation
and must get the same answers; that is how the two folds are kept equal, at the
end of a run and at every step of it.

After an intended change to the protocol or to the demo, regenerate with

    UPDATE_FIXTURES=1 uv run pytest tests/test_fixtures.py

and review the diff.
"""

import json
import os
from pathlib import Path

import pytest

from server.documents.registry import DocumentRegistry
from server.events.models import AgentEvent
from server.events.models import AgentEventType as T
from server.runtime.simple_runtime import SimpleRuntime, sheet
from server.tools.base import default_registry
from server.websocket.manager import RunStreamManager
from server.workflow.demo import demo_workflow
from server.workflow.executor import WorkflowExecutor
from server.workflow.models import Workflow

FIXTURES = Path(__file__).resolve().parents[3] / "tests" / "fixtures"
STAMP = "2026-10-05T14:31:02.000Z"
DEMO_INPUT = "Find the latest sales number and send it to management."


def stamped(run_id, drafts):
    """Events as they look on the wire, with nothing that varies between runs.

    Timestamps are deliberately identical: order must come from `sequence`.
    """
    events = []
    for sequence, (type_, actor, target, payload) in enumerate(drafts, start=1):
        payload = json.loads(json.dumps(payload))  # a private copy, JSON types only
        metrics = payload.get("metrics")
        if isinstance(metrics, dict):
            for timing in ("durationMs", "latencyMs"):
                if timing in metrics:
                    metrics[timing] = 0
        event = AgentEvent(
            id=f"evt_{sequence:04d}",
            run_id=run_id,
            sequence=sequence,
            timestamp=STAMP,
            type=type_,
            actor_id=actor,
            target_id=target,
            payload=payload,
        )
        events.append(event.to_wire())
    return events


def places_after_each_event(events):
    registry, timeline = DocumentRegistry(), []
    for event in events:
        registry.apply(AgentEvent.model_validate(event))
        timeline.append({document.id: document.place.to_wire() for document in registry.documents.values()})
    return timeline


def export(run_id, workflow, run_input, events):
    registry = DocumentRegistry.fold(AgentEvent.model_validate(event) for event in events)
    return {
        "run": {
            "id": run_id,
            "workflowId": workflow.id,
            "status": "finished",
            "input": run_input,
            "createdAt": STAMP,
            "finishedAt": STAMP,
            "workflow": workflow.to_wire(),
        },
        "events": events,
        "registry": registry.to_wire(),
        "places": places_after_each_event(events),
    }


def check(name, actual):
    path = FIXTURES / name
    if os.environ.get("UPDATE_FIXTURES"):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(actual, indent=2, ensure_ascii=False) + "\n", "utf-8")
    assert path.is_file(), f"{path} is missing: run with UPDATE_FIXTURES=1"
    assert json.loads(path.read_text("utf-8")) == actual, f"{name} is out of date: see this module's docstring"


async def test_the_demo_run_is_exactly_the_shared_fixture(runs, events):
    """The deterministic demo, as the real runtime emits it. Never break it."""
    run = runs.create(demo_workflow(), DEMO_INPUT)
    await WorkflowExecutor(SimpleRuntime(default_registry()), runs, events, RunStreamManager()).execute(run)
    drafts = [(e.type, e.actor_id, e.target_id, e.payload) for e in events.list(run.id)]

    check("demo_run.json", export("run_demo", demo_workflow(), DEMO_INPUT, stamped("run_demo", drafts)))


# A run the linear runtime cannot produce yet: tables. It is what the office runtime
# of AGENTS.md §16 will emit, written out by hand so that everything downstream of the
# event log (fold, world, transcript, inspector) can be built and tested against it.

BOARD, PILE = "board", "todo"
TABLES_INPUT = "Research two suppliers and keep the board up to date."
DONE = {"metrics": {"durationMs": 0, "model": "scripted-v1"}}


def search(supplier, finding):
    return [
        (T.TOOL_CALL, "luca", None, {"tool": "web_search", "arguments": {"query": f"supplier {supplier}"}}),
        (
            T.TOOL_RESULT,
            "luca",
            None,
            {
                "tool": "web_search",
                "result": {"summary": finding, "results": []},
                "summary": finding,
                "metrics": {"latencyMs": 0},
            },
        ),
    ]


TABLES_SCENARIO = [
    (T.RUN_STARTED, None, None, {"workflowId": "tables_demo", "workflowName": "Supplier board", "input": TABLES_INPUT, **sheet("doc_input", "Task")}),
    # Anna splits the task: one sheet per supplier on the pile, and a status sheet on the board.
    (T.AGENT_STARTED, "anna", None, {"input": TABLES_INPUT, "role": "Manager", "documentIds": ["doc_input"]}),
    (T.DECISION, "anna", None, {"kind": "routing", "summary": "Two suppliers: one sheet each on the pile."}),
    (T.DOCUMENT_WRITTEN, "anna", None, {"tableId": PILE, **sheet("doc_1", "Supplier A"), "content": "Research supplier A."}),
    (T.DOCUMENT_WRITTEN, "anna", None, {"tableId": PILE, **sheet("doc_2", "Supplier B"), "content": "Research supplier B."}),
    (T.DOCUMENT_WRITTEN, "anna", None, {"tableId": BOARD, **sheet("doc_3", "Status"), "content": "0 of 2 suppliers researched."}),
    (T.AGENT_FINISHED, "anna", None, {"output": "Two sheets are on the pile.", **DONE}),
    # Luca works the pile, one sheet per turn, updating the same status sheet each time.
    (T.AGENT_STARTED, "luca", None, {"input": "", "role": "Researcher", "documentIds": []}),
    (T.DOCUMENT_TAKEN, "luca", None, {"tableId": PILE, "documentId": "doc_1", "remaining": 1}),
    (T.DOCUMENT_READ, "luca", None, {"tableId": BOARD, "documentIds": ["doc_3"]}),
    *search("A", "Supplier A: reliable, 30 days delivery"),
    (T.DOCUMENT_WRITTEN, "luca", None, {"tableId": BOARD, **sheet("doc_3", "Status", 2), "content": "1 of 2 suppliers researched.\nA: reliable, 30 days delivery."}),
    (T.AGENT_FINISHED, "luca", None, {"output": "Supplier A is on the board.", **DONE}),
    (T.AGENT_STARTED, "luca", None, {"input": "", "role": "Researcher", "documentIds": []}),
    (T.DOCUMENT_TAKEN, "luca", None, {"tableId": PILE, "documentId": "doc_2", "remaining": 0}),
    *search("B", "Supplier B: cheaper, 60 days delivery"),
    (T.DOCUMENT_WRITTEN, "luca", None, {"tableId": BOARD, **sheet("doc_3", "Status", 3), "content": "2 of 2 suppliers researched.\nA: reliable, 30 days delivery.\nB: cheaper, 60 days delivery."}),
    (T.DECISION, "luca", None, {"kind": "handoff", "summary": "The pile is empty. Hand off to Gianni.", "target": "gianni"}),
    (T.MESSAGE_SENT, "luca", "gianni", {"content": "Both suppliers are on the board. Please send the summary.", **sheet("doc_4", "Message to Gianni")}),
    (T.AGENT_FINISHED, "luca", None, {"output": "Both suppliers are on the board. Please send the summary.", **DONE}),
    # Gianni reads the board and sends it.
    (T.MESSAGE_RECEIVED, "gianni", "luca", {"content": "Both suppliers are on the board. Please send the summary.", **sheet("doc_4", "Message to Gianni")}),
    (T.AGENT_STARTED, "gianni", None, {"input": "Both suppliers are on the board. Please send the summary.", "role": "Communication", "documentIds": ["doc_4"]}),
    (T.DOCUMENT_READ, "gianni", None, {"tableId": BOARD, "documentIds": ["doc_3"]}),
    (T.TOOL_CALL, "gianni", None, {"tool": "send_email", "arguments": {"to": "management@example.com", "subject": "Suppliers", "body": "A: reliable, 30 days delivery.\nB: cheaper, 60 days delivery."}}),
    (T.TOOL_RESULT, "gianni", None, {"tool": "send_email", "result": {"summary": "Email sent to management@example.com", "status": "sent"}, "summary": "Email sent to management@example.com", "metrics": {"latencyMs": 0}}),
    (T.AGENT_FINISHED, "gianni", None, {"output": "Email sent to management@example.com", **DONE}),
    (T.RUN_FINISHED, None, None, {"output": "Email sent to management@example.com", **sheet("doc_5", "Result"), "authorId": "gianni"}),
]


def tables_workflow() -> Workflow:
    return Workflow.model_validate(
        {
            **demo_workflow().to_wire(),
            "id": "tables_demo",
            "name": "Supplier board",
            "input": TABLES_INPUT,
            "tables": [
                {"id": PILE, "name": "To research", "mode": "pile"},
                {"id": BOARD, "name": "Board", "mode": "shared"},
            ],
        }
    )


def test_the_tables_scenario_is_the_shared_fixture():
    check("tables_run.json", export("run_tables", tables_workflow(), TABLES_INPUT, stamped("run_tables", TABLES_SCENARIO)))


def test_the_tables_scenario_ends_with_one_versioned_sheet_on_the_board():
    stored = json.loads((FIXTURES / "tables_run.json").read_text("utf-8"))["registry"]
    assert stored["tables"] == {PILE: [], BOARD: ["doc_3"]}
    assert [version["version"] for version in stored["documents"]["doc_3"]["versions"]] == [1, 2, 3]
    assert {doc: record["place"]["kind"] for doc, record in stored["documents"].items()} == {
        "doc_input": "filed",
        "doc_1": "filed",
        "doc_2": "filed",
        "doc_3": "table",
        "doc_4": "filed",
        "doc_5": "tray",
    }


@pytest.mark.parametrize("name", ["demo_run.json", "tables_run.json"])
def test_a_stored_fixture_folds_to_its_stored_registry(name):
    stored = json.loads((FIXTURES / name).read_text("utf-8"))
    folded = DocumentRegistry.fold(AgentEvent.model_validate(event) for event in stored["events"])
    assert folded.to_wire() == stored["registry"]
    assert places_after_each_event(stored["events"]) == stored["places"]
    assert len(stored["places"]) == len(stored["events"])
    # An export needs nothing but its events to rebuild every document.
    assert stored["registry"]["order"][0] == "doc_input"
