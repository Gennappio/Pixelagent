import pytest

from server.events.models import AgentEventType as T
from server.runtime.simple_runtime import SimpleRuntime
from server.storage.workflow_repository import WorkflowRepository
from server.tools.base import default_registry
from server.websocket.manager import RunStreamManager
from server.workflow.demo import demo_workflow
from server.workflow.executor import WorkflowExecutor
from server.workflow.models import RunStatus, Workflow
from server.workflow.plan import WorkflowError, build_plan

DEMO_INPUT = "Find the latest sales number and send it to management."

# (type, actor, target) of the demo scenario: the project's integration test.
DEMO_TRACE = [
    (T.RUN_STARTED, None, None),
    (T.AGENT_STARTED, "anna", None),
    (T.DECISION, "anna", None),
    (T.MESSAGE_SENT, "anna", "luca"),
    (T.AGENT_FINISHED, "anna", None),
    (T.MESSAGE_RECEIVED, "luca", "anna"),
    (T.AGENT_STARTED, "luca", None),
    (T.DECISION, "luca", None),
    (T.TOOL_CALL, "luca", None),
    (T.TOOL_RESULT, "luca", None),
    (T.DECISION, "luca", None),
    (T.MESSAGE_SENT, "luca", "gianni"),
    (T.AGENT_FINISHED, "luca", None),
    (T.MESSAGE_RECEIVED, "gianni", "luca"),
    (T.AGENT_STARTED, "gianni", None),
    (T.DECISION, "gianni", None),
    (T.TOOL_CALL, "gianni", None),
    (T.TOOL_RESULT, "gianni", None),
    (T.AGENT_FINISHED, "gianni", None),
    (T.RUN_FINISHED, None, None),
]


async def collect(workflow, run_input=DEMO_INPUT):
    return [draft async for draft in SimpleRuntime(default_registry()).run(workflow, run_input)]


def without_metrics(drafts):
    return [
        (d.type, d.actor_id, d.target_id, {k: v for k, v in d.payload.items() if k != "metrics"}) for d in drafts
    ]


async def test_demo_workflow_produces_the_expected_trace():
    drafts = await collect(demo_workflow())
    assert [(d.type, d.actor_id, d.target_id) for d in drafts] == DEMO_TRACE


async def test_demo_workflow_content():
    drafts = await collect(demo_workflow())
    sent = [d.payload["content"] for d in drafts if d.type is T.MESSAGE_SENT]
    assert sent == ["Find the latest sales number.", "Send this result to management: Sales: €1.2M"]

    calls = [d.payload for d in drafts if d.type is T.TOOL_CALL]
    assert calls[0] == {"tool": "web_search", "arguments": {"query": "Find the latest sales number."}}
    assert calls[1]["tool"] == "send_email"
    assert calls[1]["arguments"]["body"] == "Send this result to management: Sales: €1.2M"

    results = [d.payload["summary"] for d in drafts if d.type is T.TOOL_RESULT]
    assert results == ["Sales: €1.2M", "Email sent to management@example.com"]


async def test_demo_workflow_passes_documents_between_agents():
    drafts = await collect(demo_workflow())
    sheets = [
        (d.type, d.payload["documentId"], d.payload["version"], d.payload["title"])
        for d in drafts
        if "documentId" in d.payload
    ]
    assert sheets == [
        (T.RUN_STARTED, "doc_input", 1, "Task"),
        (T.MESSAGE_SENT, "doc_1", 1, "Message to Luca"),
        (T.MESSAGE_RECEIVED, "doc_1", 1, "Message to Luca"),
        (T.MESSAGE_SENT, "doc_2", 1, "Message to Gianni"),
        (T.MESSAGE_RECEIVED, "doc_2", 1, "Message to Gianni"),
        (T.RUN_FINISHED, "doc_3", 1, "Result"),
    ]
    # Each agent starts its turn from the sheet it was given.
    started = [(d.actor_id, d.payload["documentIds"]) for d in drafts if d.type is T.AGENT_STARTED]
    assert started == [("anna", ["doc_input"]), ("luca", ["doc_1"]), ("gianni", ["doc_2"])]
    assert drafts[-1].payload["authorId"] == "gianni"


async def test_saved_context_points_at_the_sheets_involved():
    drafts = await collect(demo_workflow())
    luca = next(d for d in drafts if d.type is T.AGENT_FINISHED and d.actor_id == "luca")
    referenced = [(item["kind"], item["documentId"]) for item in luca.payload["context"] if "documentId" in item]
    assert referenced == [("message", "doc_1"), ("message_out", "doc_2")]


async def test_demo_workflow_is_deterministic():
    assert without_metrics(await collect(demo_workflow())) == without_metrics(await collect(demo_workflow()))


async def test_agent_context_is_captured_when_the_agent_finishes():
    drafts = await collect(demo_workflow())
    luca = next(d for d in drafts if d.type is T.AGENT_FINISHED and d.actor_id == "luca")
    assert [item["kind"] for item in luca.payload["context"]] == [
        "system",
        "message",
        "decision",
        "tool_call",
        "tool_result",
        "decision",
        "message_out",
    ]


def test_plan_follows_the_graph_and_attaches_tools():
    plan = build_plan(demo_workflow())
    assert [(step.agent.id, step.tools) for step in plan] == [
        ("anna", []),
        ("luca", ["web_search"]),
        ("gianni", ["send_email"]),
    ]


def edit(**changes) -> Workflow:
    return Workflow.model_validate({**demo_workflow().to_wire(), **changes})


def test_tables_are_part_of_the_workflow_and_default_to_none():
    assert demo_workflow().tables == []
    with_tables = edit(tables=[{"id": "board", "name": "Board"}, {"id": "todo", "mode": "pile", "scope": "global"}])
    assert [(t.id, t.mode.value, t.scope.value) for t in with_tables.tables] == [
        ("board", "shared", "room"),
        ("todo", "pile", "global"),
    ]
    assert Workflow.model_validate(with_tables.to_wire()) == with_tables


@pytest.mark.parametrize(
    "tables, problem",
    [
        ([{"id": "board"}, {"id": "board"}], "table ids must be unique"),
        ([{"id": "anna"}], "cannot share an id"),
        ([{"id": "board", "mode": "heap"}], "mode"),
    ],
)
def test_invalid_tables_are_rejected(tables, problem):
    with pytest.raises(ValueError, match=problem):
        edit(tables=tables)


def test_plan_rejects_a_disconnected_graph():
    wire = demo_workflow().to_wire()
    edges = [edge for edge in wire["edges"] if edge["id"] != "e_luca_gianni"]
    with pytest.raises(WorkflowError, match="Luca is not connected"):
        build_plan(edit(edges=edges))


def test_plan_rejects_cycles():
    wire = demo_workflow().to_wire()
    edges = [edge for edge in wire["edges"] if edge["id"] != "e_gianni_end"]
    edges.append({"id": "loop", "source": "node_gianni", "target": "node_anna"})
    with pytest.raises(WorkflowError, match="cycle"):
        build_plan(edit(edges=edges))


@pytest.fixture
def executor(runs, events):
    return WorkflowExecutor(SimpleRuntime(default_registry()), runs, events, RunStreamManager())


async def test_executor_persists_the_run_with_ordered_sequences(executor, runs, events):
    run = runs.create(demo_workflow(), DEMO_INPUT)
    await executor.execute(run)

    stored = events.list(run.id)
    assert [(e.type, e.actor_id, e.target_id) for e in stored] == DEMO_TRACE
    assert [e.sequence for e in stored] == list(range(1, len(DEMO_TRACE) + 1))
    assert runs.get(run.id).status is RunStatus.FINISHED


async def test_tool_failure_becomes_a_run_error_event(executor, runs, events):
    wire = demo_workflow().to_wire()
    for node in wire["nodes"]:
        if node["id"] == "node_search":
            node["tool"] = "calculator"  # "Find the latest sales number." is not arithmetic
    run = runs.create(edit(nodes=wire["nodes"], agents=[{**a, "tools": []} for a in wire["agents"]]), DEMO_INPUT)
    await executor.execute(run)

    last = events.list(run.id)[-1]
    assert last.type is T.RUN_ERROR
    assert last.actor_id == "luca"
    assert "calculator failed" in last.payload["message"]
    assert runs.get(run.id).status is RunStatus.ERROR


async def test_invalid_graph_becomes_a_run_error_event(executor, runs, events):
    run = runs.create(edit(edges=[]), DEMO_INPUT)
    await executor.execute(run)

    stored = events.list(run.id)
    assert [e.type for e in stored] == [T.RUN_STARTED, T.RUN_ERROR]
    assert "Start is not connected" in stored[-1].payload["message"]


def test_workflow_round_trips_through_storage(tmp_path):
    repository = WorkflowRepository(tmp_path)
    repository.save(demo_workflow())
    assert repository.get("demo") == demo_workflow()

    renamed = edit(name="Renamed", agents=demo_workflow().to_wire()["agents"][:1], nodes=[], edges=[])
    repository.save(renamed)
    assert repository.get("demo") == renamed
    assert [summary.name for summary in repository.list()] == ["Renamed"]
