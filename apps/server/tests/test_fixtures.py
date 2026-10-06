"""Run logs and workflows shared with the web client, in <repo>/tests/fixtures.

*_run.json has the shape of a run export (so it also opens in the UI with
Runs → Open file) plus two things derived from its events: `registry`, the
documents the whole log folds to, and `places`, where every document is after
each event. The web tests fold the same events with their own implementation
and must get the same answers; that is how the two folds are kept equal, at
the end of a run and at every step of it.

The three runs are real: each is what the office runtime emits for a workflow
in <repo>/workflows. A change to the runtime, to the protocol or to one of
those workflows shows up here.

workflow_v1.json holds workflows of revision 1 next to what they upgrade to;
the web client upgrades the same ones with its own function.

After an intended change, regenerate with

    UPDATE_FIXTURES=1 uv run pytest tests/test_fixtures.py

and review the diff.
"""

import json
import os
from pathlib import Path

import pytest
from test_workflow import V1

from server.documents.registry import DocumentRegistry
from server.events.models import AgentEvent
from server.runtime.office_runtime import OfficeRuntime
from server.storage.workflow_repository import WorkflowRepository
from server.tools.base import default_registry
from server.websocket.manager import RunStreamManager
from server.workflow.demo import WORKFLOWS_DIR
from server.workflow.executor import WorkflowExecutor
from server.workflow.models import WorkflowDefinition

FIXTURES = Path(__file__).resolve().parents[3] / "tests" / "fixtures"
STAMP = "2026-10-05T14:31:02.000Z"

# fixture file → (workflow in <repo>/workflows, how many agents may work at once)
RUNS = {
    # The deterministic demo. Never break it.
    "demo_run.json": ("demo", 1),
    # A pile worked sheet by sheet, a shared board, a splitter and a collector.
    "tables_run.json": ("supplier_board", 1),
    # Two agents at work at the same time, and a third who waits for both.
    "parallel_run.json": ("two_desks", 2),
}


def stamped(run_id, stored):
    """Events as they look on the wire, with nothing that varies between runs.

    Timestamps are deliberately identical: order must come from `sequence`.
    """
    events = []
    for sequence, event in enumerate(stored, start=1):
        payload = json.loads(json.dumps(event.payload))  # a private copy, JSON types only
        metrics = payload.get("metrics")
        if isinstance(metrics, dict):
            for timing in ("durationMs", "latencyMs"):
                if timing in metrics:
                    metrics[timing] = 0
        wire = AgentEvent(
            id=f"evt_{sequence:04d}",
            run_id=run_id,
            sequence=sequence,
            timestamp=STAMP,
            type=event.type,
            actor_id=event.actor_id,
            target_id=event.target_id,
            payload=payload,
        )
        events.append(wire.to_wire())
    return events


def places_after_each_event(events):
    registry, timeline = DocumentRegistry(), []
    for event in events:
        registry.apply(AgentEvent.model_validate(event))
        timeline.append({document.id: document.place.to_wire() for document in registry.documents.values()})
    return timeline


def check(name, actual):
    path = FIXTURES / name
    if os.environ.get("UPDATE_FIXTURES"):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(actual, indent=2, ensure_ascii=False) + "\n", "utf-8")
    assert path.is_file(), f"{path} is missing: run with UPDATE_FIXTURES=1"
    assert json.loads(path.read_text("utf-8")) == actual, f"{name} is out of date: see this module's docstring"


@pytest.mark.parametrize("name", RUNS)
async def test_a_real_run_is_exactly_its_shared_fixture(name, runs, events):
    workflow_id, concurrency = RUNS[name]
    workflow = WorkflowRepository(WORKFLOWS_DIR).get(workflow_id)
    assert workflow is not None, f"workflows/{workflow_id}.json is missing"

    run = runs.create(workflow, workflow.input)
    executor = WorkflowExecutor(OfficeRuntime(default_registry(), concurrency=concurrency), runs, events, RunStreamManager())
    await executor.execute(run)
    run_id = f"run_{workflow_id}"
    wire = stamped(run_id, events.list(run.id))

    check(
        name,
        {
            "run": {
                "id": run_id,
                "workflowId": workflow.id,
                "status": "finished",
                "input": workflow.input,
                "createdAt": STAMP,
                "finishedAt": STAMP,
                "workflow": workflow.to_wire(),
            },
            "events": wire,
            "registry": DocumentRegistry.fold(AgentEvent.model_validate(event) for event in wire).to_wire(),
            "places": places_after_each_event(wire),
        },
    )
    assert wire[-1]["type"] == "RUN_FINISHED"


@pytest.mark.parametrize("name", RUNS)
def test_a_stored_fixture_folds_to_its_stored_registry(name):
    stored = json.loads((FIXTURES / name).read_text("utf-8"))
    folded = DocumentRegistry.fold(AgentEvent.model_validate(event) for event in stored["events"])
    assert folded.to_wire() == stored["registry"]
    assert places_after_each_event(stored["events"]) == stored["places"]
    assert len(stored["places"]) == len(stored["events"])
    # An export needs nothing but its events to rebuild every document.
    assert stored["registry"]["order"][0] == "doc_input"


def test_the_three_runs_between_them_use_every_kind_of_event_but_the_error():
    seen = set()
    for name in RUNS:
        seen |= {event["type"] for event in json.loads((FIXTURES / name).read_text("utf-8"))["events"]}
    assert seen == {
        "RUN_STARTED", "AGENT_STARTED", "AGENT_FINISHED", "MESSAGE_SENT", "MESSAGE_RECEIVED", "DECISION",
        "TOOL_CALL", "TOOL_RESULT", "DOCUMENT_WRITTEN", "DOCUMENT_READ", "DOCUMENT_TAKEN", "RUN_FINISHED",
    }  # fmt: skip


def test_the_run_on_tables_ends_with_a_versioned_sheet_on_the_board_and_empty_piles():
    stored = json.loads((FIXTURES / "tables_run.json").read_text("utf-8"))["registry"]
    assert stored["tables"] == {"todo": [], "done": [], "board": ["doc_5"]}
    assert [version["version"] for version in stored["documents"]["doc_5"]["versions"]] == [1, 2]
    assert stored["documents"]["doc_8"]["place"] == {"kind": "tray", "tray": "out"}


def test_the_parallel_run_has_two_turns_going_at_once():
    events = json.loads((FIXTURES / "parallel_run.json").read_text("utf-8"))["events"]
    order = [(event["type"], event.get("actorId")) for event in events]
    luca = (order.index(("AGENT_STARTED", "luca")), order.index(("AGENT_FINISHED", "luca")))
    gianni = (order.index(("AGENT_STARTED", "gianni")), order.index(("AGENT_FINISHED", "gianni")))
    assert gianni[0] < luca[1] and luca[0] < gianni[1]
    # Marta waited for both.
    marta = next(event for event in events if event["type"] == "AGENT_STARTED" and event["actorId"] == "marta")
    assert len(marta["payload"]["documentIds"]) == 2


# Workflows of revision 1, as people may still have them in files and in exported runs.
V1_CASES = {
    "a graph with tools wired and listed": V1,
    "the demo as it was": {
        "name": "Sales report demo",
        "input": "Find the latest sales number and send it to management.",
        "agents": [
            {"id": "anna", "name": "Anna", "role": "Manager", "model": {"provider": "fake", "name": "scripted-v1", "script": {"message": "Find the latest sales number."}}, "systemPrompt": "Coordinate the task and delegate work.", "tools": [], "appearance": {"sprite": "agent_female_01"}},
            {"id": "luca", "name": "Luca", "role": "Researcher", "model": {"provider": "fake", "name": "scripted-v1", "script": {"message": "Send this result to management: {result}"}}, "systemPrompt": "Research the request using the available tools and report the findings.", "tools": [{"name": "web_search"}], "appearance": {"sprite": "agent_male_01"}},
            {"id": "gianni", "name": "Gianni", "role": "Communication", "model": {"provider": "fake", "name": "scripted-v1"}, "systemPrompt": "Deliver results to the right people.", "tools": [{"name": "send_email"}], "appearance": {"sprite": "agent_male_02"}},
        ],
        "nodes": [
            {"id": "start", "type": "start", "position": {"x": 40.0, "y": 40.0}},
            {"id": "node_anna", "type": "agent", "agentId": "anna", "position": {"x": 0.0, "y": 140.0}},
            {"id": "node_luca", "type": "agent", "agentId": "luca", "position": {"x": 0.0, "y": 280.0}},
            {"id": "node_search", "type": "tool", "tool": "web_search", "position": {"x": 280.0, "y": 290.0}},
            {"id": "node_gianni", "type": "agent", "agentId": "gianni", "position": {"x": 0.0, "y": 420.0}},
            {"id": "node_email", "type": "tool", "tool": "send_email", "position": {"x": 280.0, "y": 430.0}},
            {"id": "end", "type": "end", "position": {"x": 40.0, "y": 560.0}},
        ],
        "edges": [
            {"id": "e_start_anna", "source": "start", "target": "node_anna"},
            {"id": "e_anna_luca", "source": "node_anna", "target": "node_luca"},
            {"id": "e_luca_search", "source": "node_luca", "target": "node_search"},
            {"id": "e_luca_gianni", "source": "node_luca", "target": "node_gianni"},
            {"id": "e_gianni_email", "source": "node_gianni", "target": "node_email"},
            {"id": "e_gianni_end", "source": "node_gianni", "target": "end"},
        ],
        "id": "demo",
    },
    "an office nobody wired up, with a table": {
        "name": "Draft",
        "input": "",
        "agents": [{"id": "x", "name": "X", "tools": [{"name": "web_search"}]}, {"id": "y", "name": "Y"}],
        "tables": [{"id": "board", "name": "Board", "mode": "shared", "scope": "room"}],
        "nodes": [{"id": "start", "type": "start"}, {"id": "end", "type": "end"}, {"id": "nx", "type": "agent", "agentId": "x"}],
        "edges": [{"id": "loop", "source": "nx", "target": "nx"}, {"id": "ghost", "source": "nx", "target": "nowhere"}],
    },
    "no graph at all, only agents that still list their tools": {
        "agents": [{"id": "solo", "name": "Solo", "tools": [{"name": "calculator"}, {"name": "calculator"}, {"name": "web_search"}]}],
    },
}  # fmt: skip


def test_revision_1_workflows_upgrade_to_the_shared_fixture():
    check(
        "workflow_v1.json",
        {"cases": [{"name": name, "v1": v1, "v2": WorkflowDefinition.model_validate(v1).to_wire()} for name, v1 in V1_CASES.items()]},
    )


def test_the_demo_as_it_was_upgrades_to_the_demo_as_it_is():
    from server.workflow.demo import demo_workflow

    upgraded = WorkflowDefinition.model_validate(V1_CASES["the demo as it was"]).to_wire()
    current = {key: value for key, value in demo_workflow().to_wire().items() if key != "id"}
    assert upgraded == current
