import asyncio

import pytest
from office import DEMO_INPUT, agent, office, run, without_metrics

from server.events.models import AgentEventType as T
from server.runtime.base import BudgetExceeded, Deadlock, NoResult, ToolError
from server.runtime.office_runtime import OfficeRuntime
from server.tools.base import default_registry
from server.websocket.manager import RunStreamManager
from server.workflow.demo import demo_workflow
from server.workflow.executor import WorkflowExecutor
from server.workflow.models import RunStatus, Workflow
from server.workflow.relations import WorkflowError

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


def trace(drafts):
    return [(d.type, d.actor_id, d.target_id) for d in drafts]


def of_type(drafts, type_, actor=None):
    return [d for d in drafts if d.type is type_ and (actor is None or d.actor_id == actor)]


def sent(drafts):
    return [(d.actor_id, d.target_id, d.payload["content"]) for d in of_type(drafts, T.MESSAGE_SENT)]


# -- the demo: all relations required, one agent after the other


async def test_demo_workflow_produces_the_expected_trace():
    assert trace(await run(demo_workflow(), DEMO_INPUT)) == DEMO_TRACE


async def test_demo_workflow_content():
    drafts = await run(demo_workflow(), DEMO_INPUT)
    assert [content for _, _, content in sent(drafts)] == [
        "Find the latest sales number.",
        "Send this result to management: Sales: €1.2M",
    ]
    calls = [d.payload for d in of_type(drafts, T.TOOL_CALL)]
    assert calls[0] == {"tool": "web_search", "arguments": {"query": "Find the latest sales number."}}
    assert calls[1]["tool"] == "send_email"
    assert calls[1]["arguments"]["body"] == "Send this result to management: Sales: €1.2M"
    assert [d.payload["summary"] for d in of_type(drafts, T.TOOL_RESULT)] == ["Sales: €1.2M", "Email sent to management@example.com"]


async def test_demo_workflow_passes_documents_between_agents():
    drafts = await run(demo_workflow(), DEMO_INPUT)
    sheets = [(d.type, d.payload["documentId"], d.payload["version"], d.payload["title"]) for d in drafts if "documentId" in d.payload]
    assert sheets == [
        (T.RUN_STARTED, "doc_input", 1, "Task"),
        (T.MESSAGE_SENT, "doc_1", 1, "Message to Luca"),
        (T.MESSAGE_RECEIVED, "doc_1", 1, "Message to Luca"),
        (T.MESSAGE_SENT, "doc_2", 1, "Message to Gianni"),
        (T.MESSAGE_RECEIVED, "doc_2", 1, "Message to Gianni"),
        (T.RUN_FINISHED, "doc_3", 1, "Result"),
    ]
    # Each agent starts its turn from the sheet it was given.
    assert [(d.actor_id, d.payload["documentIds"]) for d in of_type(drafts, T.AGENT_STARTED)] == [
        ("anna", ["doc_input"]),
        ("luca", ["doc_1"]),
        ("gianni", ["doc_2"]),
    ]
    assert drafts[-1].payload["authorId"] == "gianni"


async def test_a_hand_off_names_the_relation_it_follows():
    drafts = await run(demo_workflow(), DEMO_INPUT)
    handoffs = [(d.actor_id, d.payload["relationId"], d.payload["target"]) for d in of_type(drafts, T.DECISION) if d.payload["kind"] == "handoff"]
    assert handoffs == [("anna", "r2", "luca"), ("luca", "r4", "gianni")]


async def test_agent_context_is_captured_when_the_agent_finishes():
    drafts = await run(demo_workflow(), DEMO_INPUT)
    luca = of_type(drafts, T.AGENT_FINISHED, "luca")[0]
    assert [item["kind"] for item in luca.payload["context"]] == [
        "system",
        "message",
        "decision",
        "tool_call",
        "tool_result",
        "decision",
        "message_out",
    ]
    referenced = [(item["kind"], item["documentId"]) for item in luca.payload["context"] if "documentId" in item]
    assert referenced == [("message", "doc_1"), ("message_out", "doc_2")]
    gianni = of_type(drafts, T.AGENT_FINISHED, "gianni")[0]
    assert gianni.payload["context"][-1] == {"kind": "output", "content": "Email sent to management@example.com"}


async def test_demo_workflow_is_deterministic():
    assert without_metrics(await run(demo_workflow(), DEMO_INPUT)) == without_metrics(await run(demo_workflow(), DEMO_INPUT))


async def test_a_chain_gives_the_same_log_however_many_agents_may_work_at_once():
    alone = without_metrics(await run(demo_workflow(), DEMO_INPUT, concurrency=1))
    for concurrency in (2, 4, 16):
        assert without_metrics(await run(demo_workflow(), DEMO_INPUT, concurrency=concurrency)) == alone


# -- sends_to


async def test_required_hand_offs_follow_their_order_then_the_order_they_are_written_in():
    workflow = office(
        ["anna", "luca", "gianni", "marta"],
        [
            ("anna", "is_entry"),
            ("anna", "sends_to", "luca"),
            ("anna", "sends_to", "gianni", {"order": 1}),
            ("anna", "sends_to", "marta"),
            ("marta", "is_exit"),
        ],
    )
    drafts = await run(workflow)
    assert [target for sender, target, _ in sent(drafts) if sender == "anna"] == ["gianni", "luca", "marta"]


async def test_an_optional_hand_off_is_a_choice_and_the_fake_agent_takes_the_first():
    workflow = office(
        ["anna", "luca", "gianni"],
        [
            ("anna", "is_entry"),
            ("anna", "sends_to", "luca", {"required": False}),
            ("anna", "sends_to", "gianni", {"required": False}),
            ("luca", "is_exit"),
        ],
    )
    drafts = await run(workflow)
    assert sent(drafts) == [("anna", "luca", "go")]
    choice = of_type(drafts, T.DECISION, "anna")[0].payload
    assert choice["kind"] == "routing"
    assert choice["relationId"] == "r2"
    assert choice["summary"] == "The first option available: Luca."
    assert of_type(drafts, T.AGENT_STARTED, "gianni") == []


async def test_required_hand_offs_happen_whatever_the_agent_chooses():
    workflow = office(
        ["anna", "luca", "gianni"],
        [
            ("anna", "is_entry"),
            ("anna", "sends_to", "luca", {"required": False}),
            ("anna", "sends_to", "gianni"),
            ("gianni", "is_exit"),
        ],
    )
    drafts = await run(workflow)
    # Required first, then what was chosen.
    assert [target for _, target, _ in sent(drafts)] == ["gianni", "luca"]
    assert [d.payload["kind"] for d in of_type(drafts, T.DECISION, "anna")] == ["handoff", "routing"]


async def test_an_agent_handed_two_sheets_takes_two_turns():
    workflow = office(
        ["anna", "luca", "marta"],
        [
            ("anna", "is_entry"),
            ("anna", "sends_to", "luca"),
            ("anna", "sends_to", "marta"),
            ("luca", "sends_to", "marta"),
            ("marta", "is_exit"),
        ],
    )
    drafts = await run(workflow)
    turns = of_type(drafts, T.AGENT_STARTED, "marta")
    assert [turn.payload["documentIds"] for turn in turns] == [["doc_2"], ["doc_3"]]


# -- waits_for


def two_desks(**changes):
    sentences = [
        ("anna", "is_entry"),
        ("anna", "sends_to", "luca"),
        ("anna", "sends_to", "gianni"),
        ("luca", "sends_to", "marta"),
        ("gianni", "sends_to", "marta"),
        ("marta", "waits_for", "luca"),
        ("marta", "waits_for", "gianni"),
        ("marta", "is_exit"),
    ]
    return office(["anna", "luca", "gianni", agent("marta", script={"message": "Both: {input}"})], changes.get("sentences", sentences))


async def test_an_agent_that_waits_starts_once_with_a_sheet_from_each():
    drafts = await run(two_desks())
    turns = of_type(drafts, T.AGENT_STARTED, "marta")
    assert len(turns) == 1
    assert turns[0].payload["documentIds"] == ["doc_3", "doc_4"]
    assert turns[0].payload["input"] == "go\ngo"
    assert [d.target_id for d in of_type(drafts, T.MESSAGE_RECEIVED, "marta")] == ["luca", "gianni"]
    assert drafts[-1].payload["output"] == "Both: go\ngo"


async def test_waiting_for_someone_who_never_hands_anything_over_is_a_deadlock():
    sentences = [
        ("anna", "is_entry"),
        ("anna", "sends_to", "luca"),
        ("luca", "sends_to", "marta"),
        ("marta", "waits_for", "luca"),
        ("marta", "waits_for", "gianni"),
        ("marta", "is_exit"),
    ]
    with pytest.raises(Deadlock, match="Marta is still waiting for Gianni") as error:
        await run(two_desks(sentences=sentences))
    assert error.value.actor_id == "marta"


async def test_an_office_that_goes_quiet_before_the_exit_has_spoken_has_no_result():
    workflow = office(["anna", "gianni"], [("anna", "is_entry"), ("gianni", "is_exit")])
    with pytest.raises(NoResult, match="before Gianni produced a result") as error:
        await run(workflow)
    assert error.value.actor_id == "gianni"


# -- cycles and rounds


def ping_pong(**relation):
    return office(
        ["anna", "luca"],
        [("anna", "is_entry"), ("anna", "sends_to", "luca", relation), ("luca", "sends_to", "anna"), ("anna", "is_exit")],
    )


async def test_a_cycle_goes_round_five_times_by_default_and_says_when_it_stops():
    drafts = await run(ping_pong())
    assert len(sent(drafts)) == 10  # five each way
    stops = [d for d in of_type(drafts, T.DECISION) if d.payload["kind"] == "budget"]
    assert [(d.actor_id, d.payload["relationId"]) for d in stops] == [("anna", "r2")]
    assert stops[0].payload["summary"] == "“Anna hands a sheet to Luca” has reached its limit of 5 rounds."
    assert drafts[-1].type is T.RUN_FINISHED


async def test_a_relation_can_set_its_own_number_of_rounds():
    drafts = await run(ping_pong(maxRounds=2))
    assert [sender for sender, _, _ in sent(drafts)] == ["anna", "luca", "anna", "luca"]


async def test_a_relation_off_any_cycle_has_no_limit_of_its_own():
    workflow = demo_workflow()
    from server.workflow.relations import Office

    assert all(Office(workflow).rounds(relation) is None for relation in workflow.relations)
    assert Office(ping_pong()).rounds(ping_pong().relations[1]) == 5


# -- tables


def supplier_board():
    return office(
        [
            agent("anna", script={"message": "Supplier A\nSupplier B"}),
            agent("sorter", provider="rule", name="splitter"),
            "luca",
            agent("stapler", provider="rule", name="collector"),
            "gianni",
        ],
        [
            ("anna", "is_entry"),
            ("anna", "sends_to", "sorter"),
            ("sorter", "writes_table", "todo"),
            ("luca", "takes_from_table", "todo"),
            ("luca", "uses_tool", "web_search"),
            ("luca", "writes_table", "done"),
            ("luca", "writes_table", "board"),
            ("stapler", "takes_from_table", "done"),
            ("stapler", "sends_to", "gianni"),
            ("gianni", "reads_table", "board"),
            ("gianni", "is_exit"),
        ],
        tables=[
            {"id": "todo", "name": "To research", "mode": "pile"},
            {"id": "done", "name": "Researched", "mode": "pile"},
            {"id": "board", "name": "Board", "mode": "shared"},
        ],
    )


async def test_a_splitter_writes_one_sheet_per_line_on_its_pile():
    drafts = await run(supplier_board())
    written = [(d.payload["title"], d.payload["content"]) for d in of_type(drafts, T.DOCUMENT_WRITTEN, "sorter")]
    assert written == [("Supplier A", "Supplier A"), ("Supplier B", "Supplier B")]


async def test_a_pile_is_worked_one_sheet_per_turn_oldest_first():
    drafts = await run(supplier_board())
    taken = [(d.payload["documentId"], d.payload["remaining"]) for d in of_type(drafts, T.DOCUMENT_TAKEN, "luca")]
    assert taken == [("doc_2", 1), ("doc_3", 0)]
    turns = of_type(drafts, T.AGENT_STARTED, "luca")
    assert [turn.payload["input"] for turn in turns] == ["Supplier A", "Supplier B"]
    assert [d.payload["arguments"]["query"] for d in of_type(drafts, T.TOOL_CALL, "luca")] == ["Supplier A", "Supplier B"]


async def test_writing_again_on_a_shared_table_makes_a_new_version_of_the_same_sheet():
    drafts = await run(supplier_board())
    board = [(d.payload["documentId"], d.payload["version"], d.payload["title"]) for d in of_type(drafts, T.DOCUMENT_WRITTEN) if d.payload["tableId"] == "board"]
    assert board == [("doc_5", 1, "Board"), ("doc_5", 2, "Board")]
    pile = [d.payload["documentId"] for d in of_type(drafts, T.DOCUMENT_WRITTEN, "luca") if d.payload["tableId"] == "done"]
    assert pile == ["doc_4", "doc_6"]  # a pile gets a new sheet every time


async def test_a_collector_waits_for_the_office_to_go_quiet_then_takes_the_whole_pile():
    drafts = await run(supplier_board())
    order = trace(drafts)
    first_take = order.index((T.DOCUMENT_TAKEN, "stapler", None))
    # Luca has finished both of his turns before the stapler moves.
    assert order.index((T.AGENT_FINISHED, "luca", None), order.index((T.AGENT_FINISHED, "luca", None)) + 1) < first_take
    assert [(d.payload["documentId"], d.payload["remaining"]) for d in of_type(drafts, T.DOCUMENT_TAKEN, "stapler")] == [("doc_4", 1), ("doc_6", 0)]
    assert len(of_type(drafts, T.AGENT_STARTED, "stapler")) == 1
    assert sent(drafts)[-1] == ("stapler", "gianni", "Supplier A: reliable, 30 days delivery\nSupplier B: cheaper, 60 days delivery")


async def test_reading_a_table_brings_its_sheets_into_the_agent_s_context():
    drafts = await run(supplier_board())
    read = of_type(drafts, T.DOCUMENT_READ, "gianni")
    assert [d.payload for d in read] == [{"tableId": "board", "documentIds": ["doc_5"]}]
    context = of_type(drafts, T.AGENT_FINISHED, "gianni")[0].payload["context"]
    table = next(item for item in context if item["kind"] == "table")
    assert table["documents"][0]["version"] == 2
    assert table["documents"][0]["content"] == "Supplier B: cheaper, 60 days delivery"


async def test_an_empty_table_is_not_walked_over_to():
    workflow = office(
        ["anna"],
        [("anna", "is_entry"), ("anna", "reads_table", "board"), ("anna", "is_exit")],
        tables=[{"id": "board", "mode": "shared"}],
    )
    assert of_type(await run(workflow), T.DOCUMENT_READ) == []


async def test_an_optional_write_happens_only_when_chosen():
    def with_write(required):
        return office(
            ["anna"],
            [("anna", "is_entry"), ("anna", "writes_table", "board", {"required": required}), ("anna", "is_exit")],
            tables=[{"id": "board", "mode": "shared"}],
        )

    assert len(of_type(await run(with_write(True)), T.DOCUMENT_WRITTEN)) == 1
    # The fake agent takes its first option, so an optional write, being the only one, is taken too.
    assert len(of_type(await run(with_write(False)), T.DOCUMENT_WRITTEN)) == 1


# -- rule agents


def switchboard(**model):
    """A router between Anna and two desks, either of which reports to Marta."""
    return office(
        ["anna", agent("router", provider="rule", name="router", **model), "luca", "gianni", "marta"],
        [
            ("anna", "is_entry"),
            ("anna", "sends_to", "router"),
            ("router", "sends_to", "luca", {"required": False}),
            ("router", "sends_to", "gianni", {"required": False}),
            ("luca", "sends_to", "marta"),
            ("gianni", "sends_to", "marta"),
            ("marta", "is_exit"),
        ],
    )


def routed(drafts):
    """Whom the router handed the sheet to, and the sheet."""
    return [(target, content) for sender, target, content in sent(drafts) if sender == "router"]


async def test_a_router_hands_the_sheet_on_unchanged_to_whoever_its_first_matching_rule_names():
    rules = [{"contains": "refund", "to": "gianni"}, {"contains": "invoice", "to": "luca"}]
    drafts = await run(switchboard(rules=rules), "An INVOICE and a Refund")
    assert routed(drafts) == [("gianni", "An INVOICE and a Refund")]
    decision = of_type(drafts, T.DECISION, "router")[0].payload
    assert (decision["kind"], decision["relationId"], decision["summary"]) == ("routing", "r4", "The sheet mentions “refund”: for Gianni.")
    # The desk it did not choose never hears of it.
    assert of_type(drafts, T.AGENT_STARTED, "luca") == []
    assert drafts[-1].type is T.RUN_FINISHED


async def test_a_router_falls_back_to_otherwise_then_to_its_first_option():
    rules = [{"contains": "refund", "to": "gianni"}]
    assert routed(await run(switchboard(rules=rules, otherwise="gianni"), "hello")) == [("gianni", "hello")]
    drafts = await run(switchboard(rules=rules), "hello")
    assert routed(drafts) == [("luca", "hello")]
    assert of_type(drafts, T.DECISION, "router")[0].payload["summary"] == "No rule matches: for Luca."


async def test_a_branch_that_never_reaches_the_exit_leaves_the_run_without_a_result():
    # The same router, but only Luca's desk leads anywhere: routed to Gianni, the office goes quiet.
    workflow = office(
        ["anna", agent("router", provider="rule", name="router", rules=[{"contains": "refund", "to": "gianni"}]), "luca", "gianni"],
        [
            ("anna", "is_entry"),
            ("anna", "sends_to", "router"),
            ("router", "sends_to", "luca", {"required": False}),
            ("router", "sends_to", "gianni", {"required": False}),
            ("luca", "is_exit"),
        ],
    )
    assert (await run(workflow, "an invoice"))[-1].type is T.RUN_FINISHED
    with pytest.raises(NoResult, match="before Luca produced a result"):
        await run(workflow, "a refund")


async def test_an_unknown_rule_is_an_error_of_that_agent():
    from server.runtime.base import AgentRuntimeError

    workflow = office([agent("anna", provider="rule", name="shredder")], [("anna", "is_entry"), ("anna", "is_exit")])
    with pytest.raises(AgentRuntimeError, match="unknown rule 'shredder'") as error:
        await run(workflow)
    assert error.value.actor_id == "anna"


# -- several agents at once


async def test_with_room_for_two_luca_and_gianni_work_at_the_same_time():
    def turns(drafts):
        """For each of the two, where in the log its turn begins and ends."""
        order = [(d.type, d.actor_id) for d in drafts]
        return {name: (order.index((T.AGENT_STARTED, name)), order.index((T.AGENT_FINISHED, name))) for name in ("luca", "gianni")}

    one = turns(await run(two_desks(), concurrency=1))
    two = turns(await run(two_desks(), concurrency=2))
    # One at a time: Luca's whole turn is over before Gianni's begins.
    assert one["luca"][1] < one["gianni"][0]
    # Two at a time: each begins before the other has finished.
    assert two["gianni"][0] < two["luca"][1]
    assert two["luca"][0] < two["gianni"][1]


async def test_concurrency_changes_the_order_of_the_log_not_what_happens():
    def outcome(drafts):
        return sorted((d.type, d.actor_id, d.target_id, d.payload.get("content", d.payload.get("output"))) for d in drafts if d.type in (T.MESSAGE_SENT, T.AGENT_FINISHED, T.RUN_FINISHED))

    assert outcome(await run(two_desks(), concurrency=1)) == outcome(await run(two_desks(), concurrency=2))


async def test_a_concurrent_run_is_reproducible_with_deterministic_agents():
    first = without_metrics(await run(two_desks(), concurrency=2))
    for _ in range(5):
        assert without_metrics(await run(two_desks(), concurrency=2)) == first


async def test_an_agent_never_has_two_turns_going_at_once():
    workflow = office(
        ["anna", "luca", "gianni", "marta"],
        [
            ("anna", "is_entry"),
            ("anna", "sends_to", "luca"),
            ("anna", "sends_to", "gianni"),
            ("luca", "sends_to", "marta"),
            ("gianni", "sends_to", "marta"),
            ("marta", "is_exit"),
        ],
    )
    open_turns: set[str] = set()
    for draft in await run(workflow, concurrency=8):
        if draft.type is T.AGENT_STARTED:
            assert draft.actor_id not in open_turns
            open_turns.add(draft.actor_id)
        elif draft.type is T.AGENT_FINISHED:
            open_turns.remove(draft.actor_id)
    assert open_turns == set()


# -- limits and failures


async def test_a_run_stops_at_its_limit_of_events():
    workflow = office(
        ["anna", "luca"],
        [("anna", "is_entry"), ("anna", "sends_to", "luca", {"maxRounds": 100}), ("luca", "sends_to", "anna", {"maxRounds": 100}), ("anna", "is_exit")],
        budgets={"maxEvents": 12},
    )
    with pytest.raises(BudgetExceeded, match="limit of 12 events"):
        await run(workflow)


async def test_an_agent_stops_at_its_limit_of_turns():
    workflow = office(
        ["anna", "luca"],
        [("anna", "is_entry"), ("anna", "sends_to", "luca", {"maxRounds": 100}), ("luca", "sends_to", "anna", {"maxRounds": 100}), ("anna", "is_exit")],
        budgets={"maxTurnsPerAgent": 3},
    )
    with pytest.raises(BudgetExceeded, match="Anna reached its limit of 3 turns") as error:
        await run(workflow)
    assert error.value.actor_id == "anna"


async def test_an_agent_stops_at_its_limit_of_tool_calls_in_a_turn():
    workflow = office(
        ["anna"],
        [("anna", "is_entry"), ("anna", "uses_tool", "web_search"), ("anna", "uses_tool", "send_email"), ("anna", "is_exit")],
        budgets={"maxToolCallsPerTurn": 1},
    )
    with pytest.raises(BudgetExceeded, match="limit of 1 tool calls"):
        await run(workflow)


async def test_a_failing_tool_is_an_error_of_the_agent_using_it():
    workflow = office(["anna"], [("anna", "is_entry"), ("anna", "uses_tool", "calculator"), ("anna", "is_exit")])
    with pytest.raises(ToolError, match="calculator failed") as error:
        await run(workflow, "not arithmetic")
    assert error.value.actor_id == "anna"


@pytest.mark.parametrize(
    "workflow, problem",
    [
        (office([], []), "no agents"),
        (office(["anna"], [("anna", "is_exit")]), "No agent is the entry"),
        (office(["anna"], [("anna", "is_entry")]), "No agent is the exit"),
        (office(["anna"], [("anna", "is_entry"), ("anna", "is_exit"), ("anna", "uses_tool", "teleporter")]), "does not have"),
        (office([agent("anna", provider="oracle")], [("anna", "is_entry"), ("anna", "is_exit")]), "unknown model provider 'oracle'"),
        (office([{**agent("anna"), "instances": 3}], [("anna", "is_entry"), ("anna", "is_exit")]), "not supported yet"),
    ],
)
async def test_a_workflow_that_cannot_run_says_why_after_the_run_has_started(workflow, problem):
    runtime = OfficeRuntime(default_registry())
    events = runtime.run(workflow, "go")
    assert (await anext(events)).type is T.RUN_STARTED
    with pytest.raises(WorkflowError, match=problem):
        await anext(events)


# -- through the executor: persisted, streamed, stoppable


@pytest.fixture
def executor(runs, events):
    return WorkflowExecutor(OfficeRuntime(default_registry()), runs, events, RunStreamManager())


async def test_executor_persists_the_run_with_ordered_sequences(executor, runs, events):
    run_ = runs.create(demo_workflow(), DEMO_INPUT)
    await executor.execute(run_)

    stored = events.list(run_.id)
    assert [(e.type, e.actor_id, e.target_id) for e in stored] == DEMO_TRACE
    assert [e.sequence for e in stored] == list(range(1, len(DEMO_TRACE) + 1))
    assert runs.get(run_.id).status is RunStatus.FINISHED


async def test_tool_failure_becomes_a_run_error_event(executor, runs, events):
    wire = demo_workflow().to_wire()
    for relation in wire["relations"]:
        if relation.get("object") == "web_search":
            relation["object"] = "calculator"  # "Find the latest sales number." is not arithmetic
    run_ = runs.create(Workflow.model_validate(wire), DEMO_INPUT)
    await executor.execute(run_)

    last = events.list(run_.id)[-1]
    assert last.type is T.RUN_ERROR
    assert last.actor_id == "luca"
    assert "calculator failed" in last.payload["message"]
    assert last.payload["errorType"] == "ToolError"
    assert runs.get(run_.id).status is RunStatus.ERROR


async def test_a_workflow_that_cannot_run_becomes_a_run_error_event(executor, runs, events):
    wire = demo_workflow().to_wire()
    run_ = runs.create(Workflow.model_validate({**wire, "relations": []}), DEMO_INPUT)
    await executor.execute(run_)

    stored = events.list(run_.id)
    assert [e.type for e in stored] == [T.RUN_STARTED, T.RUN_ERROR]
    assert "No agent is the entry" in stored[-1].payload["message"]
    assert stored[-1].payload["errorType"] == "WorkflowError"


async def test_a_deadlock_is_an_event_that_points_at_who_is_stuck(executor, runs, events):
    sentences = [
        ("anna", "is_entry"),
        ("anna", "sends_to", "luca"),
        ("luca", "sends_to", "marta"),
        ("marta", "waits_for", "luca"),
        ("marta", "waits_for", "gianni"),
        ("marta", "is_exit"),
    ]
    run_ = runs.create(two_desks(sentences=sentences), "go")
    await executor.execute(run_)
    last = events.list(run_.id)[-1]
    assert (last.type, last.actor_id, last.payload["errorType"]) == (T.RUN_ERROR, "marta", "Deadlock")


async def test_stopping_a_run_ends_it_with_an_event_that_says_so(runs, events):
    slow = WorkflowExecutor(OfficeRuntime(default_registry(), pace=0.05), runs, events, RunStreamManager())
    run_ = slow.start(demo_workflow(), DEMO_INPUT)
    await asyncio.sleep(0.12)
    assert slow.stop(run_.id) is True
    await slow.wait_idle()

    stored = events.list(run_.id)
    assert 1 < len(stored) < len(DEMO_TRACE)
    assert stored[-1].type is T.RUN_ERROR
    assert stored[-1].payload == {"message": "Stopped by the user.", "errorType": "Stopped"}
    assert runs.get(run_.id).status is RunStatus.STOPPED
    assert slow.stop(run_.id) is False  # nothing left to stop
    # Nothing is written after the stop.
    await asyncio.sleep(0.15)
    assert events.list(run_.id) == stored


async def test_stopping_a_run_that_is_not_running_does_nothing(executor, runs):
    run_ = runs.create(demo_workflow(), DEMO_INPUT)
    await executor.execute(run_)
    assert executor.stop(run_.id) is False
    assert executor.stop("run_unknown") is False
    assert runs.get(run_.id).status is RunStatus.FINISHED
