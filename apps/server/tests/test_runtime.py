import asyncio

import pytest
from office import DEMO_INPUT, agent, office, run, without_metrics

from server.documents.registry import DocumentRegistry
from server.events.models import AgentEventType as T
from server.runtime.base import AgentRuntimeError, BudgetExceeded, Deadlock, NoResult, ToolError
from server.runtime.office_runtime import OfficeRuntime
from server.runtime.providers.fake import FakeProvider
from server.runtime.providers.rule import RuleProvider
from server.runtime.turn import Sheet, TurnProvider, TurnResult
from server.tools.base import default_registry, sole_argument
from server.websocket.manager import RunStreamManager
from server.workflow.demo import demo_workflow
from server.workflow.executor import WorkflowExecutor
from server.workflow.models import RunStatus, Workflow
from server.workflow.relations import Office, WorkflowError

# (type, actor, target) of the demo scenario: the project's integration test.
DEMO_TRACE = [
    (T.RUN_STARTED, None, None),
    (T.AGENT_STARTED, "anna", None),
    (T.MESSAGE_SENT, "anna", "luca"),
    (T.AGENT_FINISHED, "anna", None),
    (T.MESSAGE_RECEIVED, "luca", "anna"),
    (T.AGENT_STARTED, "luca", None),
    (T.DECISION, "luca", None),
    (T.TOOL_CALL, "luca", None),
    (T.TOOL_RESULT, "luca", None),
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
    """Every hand-off: who, to whom, and what was said."""
    return [(d.actor_id, d.target_id, d.payload["message"]) for d in of_type(drafts, T.MESSAGE_SENT)]


def handed(drafts, sender=None):
    """The sheet of every hand-off that came with one: (recipient, document, version, title)."""
    return [
        (d.target_id, d.payload["documentId"], d.payload["version"], d.payload["title"])
        for d in of_type(drafts, T.MESSAGE_SENT, sender)
        if "documentId" in d.payload
    ]


def writes(title, content="{result}"):
    """A script for an agent that writes one sheet."""
    return {"sheet": {"title": title, "content": content}}


# -- the demo: all relations required, one agent after the other


async def test_demo_workflow_produces_the_expected_trace():
    assert trace(await run(demo_workflow(), DEMO_INPUT)) == DEMO_TRACE


async def test_demo_workflow_content():
    drafts = await run(demo_workflow(), DEMO_INPUT)
    # What is said is the instruction; what is handed over is the context.
    assert sent(drafts) == [("anna", "luca", "Find the latest sales number."), ("luca", "gianni", "Send this to management.")]
    assert [d.payload["content"] for d in of_type(drafts, T.MESSAGE_SENT)] == [DEMO_INPUT, "Sales: €1.2M"]
    calls = [d.payload for d in of_type(drafts, T.TOOL_CALL)]
    assert calls[0] == {"tool": "web_search", "arguments": {"query": DEMO_INPUT}}
    assert calls[1] == {"tool": "send_email", "arguments": {"to": "management@example.com", "subject": "Update from Pixel Agents", "body": "Sales: €1.2M"}}
    assert [d.payload["summary"] for d in of_type(drafts, T.TOOL_RESULT)] == ["Sales: €1.2M", "Email sent to management@example.com"]


async def test_demo_workflow_passes_documents_between_agents():
    drafts = await run(demo_workflow(), DEMO_INPUT)
    sheets = [(d.type, d.payload["documentId"], d.payload["version"], d.payload["title"]) for d in drafts if "documentId" in d.payload]
    assert sheets == [
        (T.RUN_STARTED, "doc_input", 1, "Task"),
        # Anna passes the task on as it is: the same sheet, not a copy of it.
        (T.MESSAGE_SENT, "doc_input", 1, "Task"),
        (T.MESSAGE_RECEIVED, "doc_input", 1, "Task"),
        (T.MESSAGE_SENT, "doc_1", 1, "Sales number"),
        (T.MESSAGE_RECEIVED, "doc_1", 1, "Sales number"),
        (T.RUN_FINISHED, "doc_2", 1, "Email sent"),
    ]
    # Each agent starts its turn from the sheet it was given.
    assert [(d.actor_id, d.payload["documentIds"]) for d in of_type(drafts, T.AGENT_STARTED)] == [
        ("anna", ["doc_input"]),
        ("luca", ["doc_input"]),
        ("gianni", ["doc_1"]),
    ]
    assert drafts[-1].payload == {"output": "Email sent to management@example.com", "documentId": "doc_2", "version": 1, "title": "Email sent", "authorId": "gianni"}


async def test_a_hand_off_that_always_happens_is_nobody_s_decision():
    drafts = await run(demo_workflow(), DEMO_INPUT)
    # Anna always hands to Luca: the workflow says so, and the log does not pretend she decided it.
    assert [d.type for d in drafts if d.actor_id == "anna"] == [T.AGENT_STARTED, T.MESSAGE_SENT, T.AGENT_FINISHED]
    # What is left are the choices that were made: Luca and Gianni each chose to use their tool.
    assert [(d.actor_id, d.payload["kind"]) for d in of_type(drafts, T.DECISION)] == [("luca", "tool_selection"), ("gianni", "tool_selection")]
    assert all("decision" not in [item["kind"] for item in d.payload["context"]] for d in of_type(drafts, T.AGENT_FINISHED, "anna"))


async def test_agent_context_is_captured_when_the_agent_finishes():
    drafts = await run(demo_workflow(), DEMO_INPUT)
    luca = of_type(drafts, T.AGENT_FINISHED, "luca")[0]
    # What arrived (the words, then the sheet), what he did, what he wrote, what he handed on.
    assert [item["kind"] for item in luca.payload["context"]] == [
        "system",
        "message",
        "document",
        "decision",
        "tool_call",
        "tool_result",
        "sheet",
        "message_out",
    ]
    assert luca.payload["context"][1] == {"kind": "message", "from": "anna", "content": "Find the latest sales number."}
    assert luca.payload["context"][2] == {"kind": "document", "from": "anna", "documentId": "doc_input", "version": 1, "title": "Task", "content": DEMO_INPUT}
    # The one decision in it is the one he made: to use the search.
    assert luca.payload["context"][3] == {"kind": "decision", "content": "Use web_search to handle the request."}
    assert luca.payload["context"][6] == {"kind": "sheet", "title": "Sales number", "content": "Sales: €1.2M"}
    assert luca.payload["context"][7] == {"kind": "message_out", "to": "gianni", "content": "Send this to management.", "documentId": "doc_1"}
    assert luca.payload["output"] == "Sales: €1.2M"
    # The task is a sheet nobody said anything about.
    anna = of_type(drafts, T.AGENT_FINISHED, "anna")[0]
    assert [item["kind"] for item in anna.payload["context"]][:2] == ["system", "document"]
    assert anna.payload["context"][1]["from"] == "user"


async def test_demo_workflow_is_deterministic():
    assert without_metrics(await run(demo_workflow(), DEMO_INPUT)) == without_metrics(await run(demo_workflow(), DEMO_INPUT))


async def test_a_chain_gives_the_same_log_however_many_agents_may_work_at_once():
    alone = without_metrics(await run(demo_workflow(), DEMO_INPUT, concurrency=1))
    for concurrency in (2, 4, 16):
        assert without_metrics(await run(demo_workflow(), DEMO_INPUT, concurrency=concurrency)) == alone


# -- a hand-off: something said, and at most one sheet


def chain(*scripts, sentences=None):
    """Anna, Luca and Gianni one after the other, each with the script given (None: unscripted)."""
    people = [agent(name, **({"script": script} if script is not None else {})) for name, script in zip(("anna", "luca", "gianni"), scripts)]
    return office(
        people,
        sentences or [("anna", "is_entry"), ("anna", "sends_to", "luca"), ("luca", "sends_to", "gianni"), ("gianni", "is_exit")],
    )


async def test_a_message_can_be_handed_over_without_a_sheet():
    drafts = await run(chain({"says": "Go ahead.", "sheet": False}, None, writes("Done", "{input}")))
    said = of_type(drafts, T.MESSAGE_SENT, "anna")[0]
    assert said.payload == {"message": "Go ahead."}
    assert of_type(drafts, T.MESSAGE_RECEIVED, "luca")[0].payload == {"message": "Go ahead."}
    # Luca starts from words alone: nothing in his hands, and the words are all he was given.
    luca = of_type(drafts, T.AGENT_STARTED, "luca")[0]
    assert (luca.payload["documentIds"], luca.payload["input"]) == ([], "Go ahead.")
    # Having nothing to pass on and nothing scripted, he hands Gianni nothing at all, and still does.
    assert of_type(drafts, T.MESSAGE_SENT, "luca")[0].payload == {"message": ""}
    assert of_type(drafts, T.AGENT_FINISHED, "anna")[0].payload["output"] == "Go ahead."
    # Words are not documents: the task, which Anna kept, and the result are the only sheets there ever were.
    assert list(DocumentRegistry.fold(drafts).documents) == ["doc_input", "doc_1"]
    assert drafts[-1].type is T.RUN_FINISHED


async def test_a_sheet_handed_to_several_is_photocopied_from_the_second_on():
    workflow = office(
        [agent("anna", script={"says": {"luca": "For you.", "marta": "And you."}}), "luca", "gianni", "marta"],
        [("anna", "is_entry"), ("anna", "sends_to", "luca"), ("anna", "sends_to", "gianni"), ("anna", "sends_to", "marta"), ("marta", "is_exit")],
    )
    drafts = await run(workflow, "the task")
    copies = [d.payload for d in of_type(drafts, T.MESSAGE_SENT, "anna")]
    assert copies == [
        # The first gets the sheet itself.
        {"message": "For you.", "documentId": "doc_input", "version": 1, "title": "Task", "content": "the task"},
        # The others a sheet of their own that says where it came from; a line can be left unsaid.
        {"message": "", "documentId": "doc_1", "version": 1, "title": "Task", "content": "the task", "copyOf": "doc_input"},
        {"message": "And you.", "documentId": "doc_2", "version": 1, "title": "Task", "content": "the task", "copyOf": "doc_input"},
    ]
    # What is received is what was sent, word for word.
    assert of_type(drafts, T.MESSAGE_RECEIVED, "gianni")[0].payload == copies[1]
    registry = DocumentRegistry.fold(drafts)
    assert [(document.id, document.copy_of) for document in registry.documents.values()] == [("doc_input", None), ("doc_1", "doc_input"), ("doc_2", "doc_input")]


async def test_a_sheet_written_under_the_title_of_one_in_hand_is_a_new_version_of_it():
    drafts = await run(chain(None, writes("Task", "{sheet}, checked"), None), "the task")
    assert handed(drafts) == [("luca", "doc_input", 1, "Task"), ("gianni", "doc_input", 2, "Task")]
    task = DocumentRegistry.fold(drafts).documents["doc_input"]
    assert [(version.version, version.author_id, version.content) for version in task.versions] == [(1, None, "the task"), (2, "luca", "the task, checked")]
    # Gianni passes on what he was handed: the result is that same sheet, as he got it.
    assert drafts[-1].payload == {"output": "the task, checked", "documentId": "doc_input", "version": 2, "title": "Task", "authorId": "gianni"}
    assert list(DocumentRegistry.fold(drafts).documents) == ["doc_input"]


async def test_a_sheet_passed_on_keeps_its_id_all_the_way():
    drafts = await run(chain(None, None, None), "the task")
    assert handed(drafts) == [("luca", "doc_input", 1, "Task"), ("gianni", "doc_input", 1, "Task")]
    registry = DocumentRegistry.fold(drafts)
    assert list(registry.documents) == ["doc_input"]
    assert [(touch.action, touch.agent_id, touch.peer_id) for touch in registry.documents["doc_input"].history] == [
        ("created", None, None),
        ("picked_up", "anna", None),
        ("handed", "anna", "luca"),
        ("received", "luca", "anna"),
        ("handed", "luca", "gianni"),
        ("received", "gianni", "luca"),
        ("filed", "gianni", None),
        ("delivered", "gianni", None),
    ]
    assert registry.documents["doc_input"].place.kind == "tray"


async def test_what_an_agent_was_handed_and_did_not_pass_on_is_filed_when_its_turn_ends():
    drafts = await run(chain(None, writes("Notes", "mine"), None), "the task")
    assert handed(drafts) == [("luca", "doc_input", 1, "Task"), ("gianni", "doc_1", 1, "Notes")]
    registry = DocumentRegistry.fold(drafts)
    assert registry.documents["doc_input"].place.to_wire() == {"kind": "filed", "agentId": "luca"}


async def test_one_line_is_said_to_everyone_or_a_line_to_each():
    def said(lines):
        return office(
            [agent("anna", script={"says": lines}), "luca", "gianni"],
            [("anna", "is_entry"), ("anna", "sends_to", "luca"), ("anna", "sends_to", "gianni"), ("gianni", "is_exit")],
        )

    assert [words for _, _, words in sent(await run(said("Read {input}."), "this"))][:2] == ["Read this.", "Read this."]
    assert [words for _, _, words in sent(await run(said({"gianni": "Yours."}), "this"))][:2] == ["", "Yours."]


async def test_a_turn_starts_from_what_was_said_and_then_what_was_handed_in_arrival_order():
    workflow = office(
        [agent("anna", script={"says": {"luca": "One.", "gianni": "Two."}}), "luca", agent("gianni", script={"says": "From Gianni.", "sheet": False}), "marta"],
        [
            ("anna", "is_entry"),
            ("anna", "sends_to", "luca"),
            ("anna", "sends_to", "gianni"),
            ("luca", "sends_to", "marta"),
            ("gianni", "sends_to", "marta"),
            ("marta", "waits_for", "luca"),
            ("marta", "waits_for", "gianni"),
            ("marta", "is_exit"),
        ],
    )
    drafts = await run(workflow, "the task")
    assert of_type(drafts, T.AGENT_STARTED, "luca")[0].payload["input"] == "One.\nthe task"
    marta = of_type(drafts, T.AGENT_STARTED, "marta")[0]
    # Luca said nothing and handed the task on; Gianni only talked.
    assert marta.payload["input"] == "the task\nFrom Gianni."
    assert marta.payload["documentIds"] == ["doc_input"]


async def test_the_scripted_agent_still_reads_a_script_from_before_hand_offs_had_words():
    # `message` used to be what was handed over: it still is, as the sheet, with nothing said.
    drafts = await run(chain({"message": "Find {input}."}, {"message": "Found: {result}"}, None, sentences=[
        ("anna", "is_entry"), ("anna", "sends_to", "luca"), ("luca", "uses_tool", "web_search"), ("luca", "sends_to", "gianni"), ("gianni", "is_exit"),
    ]), "the sales")  # fmt: skip
    assert sent(drafts) == [("anna", "luca", ""), ("luca", "gianni", "")]
    assert [d.payload["content"] for d in of_type(drafts, T.MESSAGE_SENT)] == ["Find the sales.", "Found: Sales: €1.2M"]
    assert [d.payload["title"] for d in of_type(drafts, T.MESSAGE_SENT)] == ["Find the sales.", "Found: Sales: €1.2M"]
    assert drafts[-1].payload["output"] == "Found: Sales: €1.2M"


async def test_an_unscripted_agent_that_used_a_tool_writes_down_what_it_found():
    workflow = office(["anna"], [("anna", "is_entry"), ("anna", "uses_tool", "web_search"), ("anna", "is_exit")])
    drafts = await run(workflow, "sales")
    assert (drafts[-1].payload["title"], drafts[-1].payload["output"], drafts[-1].payload["documentId"]) == ("Sales: €1.2M", "Sales: €1.2M", "doc_1")


class Scripted(TurnProvider):
    """A provider that ends every turn the way a test says."""

    def __init__(self, result):
        self.result = result

    async def run_turn(self, turn):
        yield self.result(turn) if callable(self.result) else self.result


async def run_with(provider, workflow, run_input="go"):
    runtime = OfficeRuntime(default_registry(), providers={"fake": FakeProvider(), "rule": RuleProvider(), "test": provider})
    return [draft async for draft in runtime.run(workflow, run_input)]


async def test_an_agent_cannot_pass_on_a_sheet_it_does_not_hold():
    workflow = office([agent("anna", provider="test")], [("anna", "is_entry"), ("anna", "is_exit")])
    with pytest.raises(AgentRuntimeError, match="Anna tried to pass on a sheet it does not hold") as error:
        await run_with(Scripted(TurnResult(sheet="doc_99")), workflow)
    assert error.value.actor_id == "anna"


async def test_the_provider_sees_what_was_said_what_it_holds_and_every_way_out():
    seen = {}

    def look(turn):
        seen.update(messages=turn.messages, sheets=turn.sheets, outputs=[r.id for r in turn.outputs], routes=[r.id for r in turn.routes], tools=[t.name for t in turn.tools])
        return TurnResult(sheet=Sheet("Reply", "ok"), says={"r6": "Here."})

    workflow = office(
        [agent("anna", script={"says": "Look into it."}), agent("luca", provider="test"), "gianni"],
        [
            ("anna", "is_entry"),
            ("anna", "sends_to", "luca"),
            ("luca", "uses_tool", "calculator"),
            ("luca", "uses_tool", "web_search", {"required": True}),
            ("luca", "sends_to", "anna", {"required": False}),
            ("luca", "sends_to", "gianni"),
            ("gianni", "is_exit"),
        ],
    )
    drafts = await run_with(Scripted(look), workflow, "2 + 2")
    assert [(said.sender, said.text) for said in seen["messages"]] == [("anna", "Look into it.")]
    assert [(held.id, held.version, held.title, held.content, held.sender) for held in seen["sheets"]] == [("doc_input", 1, "Task", "2 + 2", "anna")]
    # Every way out is offered, the optional ones marked as such; a consulted tool is not one it can call.
    assert (seen["outputs"], seen["routes"], seen["tools"]) == (["r5", "r6"], ["r5"], ["calculator"])
    assert of_type(drafts, T.MESSAGE_SENT, "luca")[0].payload == {"message": "Here.", "documentId": "doc_1", "version": 1, "title": "Reply", "content": "ok"}


async def test_hints_are_part_of_what_the_agent_knows():
    workflow = office(
        ["anna", "luca"],
        [("anna", "is_entry"), ("anna", "sends_to", "luca", {"required": False, "hint": "only when the numbers are missing"}), ("anna", "is_exit")],
    )
    context = of_type(await run(workflow), T.AGENT_FINISHED, "anna")[0].payload["context"]
    assert context[1] == {"kind": "hint", "relationId": "r2", "sentence": "Anna hands to Luca", "content": "only when the numbers are missing"}


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
    assert sent(drafts) == [("anna", "luca", "")]
    assert handed(drafts) == [("luca", "doc_input", 1, "Task")]
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
    # Only the hand-off she chose is a decision, and it says which sentence it follows and to whom.
    choices = [d.payload for d in of_type(drafts, T.DECISION, "anna")]
    assert [(choice["kind"], choice["relationId"], choice["target"]) for choice in choices] == [("routing", "r2", "luca")]
    order = [(d.type, d.target_id) for d in drafts if d.actor_id == "anna" and d.type in (T.DECISION, T.MESSAGE_SENT)]
    assert order == [(T.MESSAGE_SENT, "gianni"), (T.DECISION, None), (T.MESSAGE_SENT, "luca")]


async def test_what_goes_out_follows_the_order_of_the_sentences_whether_handed_or_written():
    workflow = office(
        [agent("anna", script=writes("Note", "{input}")), "luca"],
        [("anna", "is_entry"), ("anna", "writes_table", "board"), ("anna", "sends_to", "luca", {"order": 1}), ("anna", "writes_table", "notes"), ("luca", "is_exit")],
        tables=[{"id": "board"}, {"id": "notes"}],
    )
    drafts = await run(workflow)
    out = [(d.type, d.target_id or d.payload["tableId"]) for d in drafts if d.actor_id == "anna" and d.type in (T.MESSAGE_SENT, T.DOCUMENT_WRITTEN)]
    assert out == [(T.MESSAGE_SENT, "luca"), (T.DOCUMENT_WRITTEN, "board"), (T.DOCUMENT_WRITTEN, "notes")]


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
    # First Anna's photocopy, then the sheet itself, which went by way of Luca.
    assert [turn.payload["documentIds"] for turn in turns] == [["doc_1"], ["doc_input"]]


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
    return office(["anna", "luca", "gianni", agent("marta", script=writes("Both", "Both: {input}"))], changes.get("sentences", sentences))


async def test_an_agent_that_waits_starts_once_with_a_hand_off_from_each():
    drafts = await run(two_desks())
    turns = of_type(drafts, T.AGENT_STARTED, "marta")
    assert len(turns) == 1
    assert turns[0].payload["documentIds"] == ["doc_input", "doc_1"]
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


# -- the result


async def test_an_office_that_goes_quiet_before_the_exit_has_had_a_turn_has_no_result():
    workflow = office(["anna", "gianni"], [("anna", "is_entry"), ("gianni", "is_exit")])
    with pytest.raises(NoResult, match="before Gianni produced a sheet") as error:
        await run(workflow)
    assert error.value.actor_id == "gianni"


async def test_an_exit_that_only_talks_leaves_no_result():
    workflow = office([agent("anna", script={"says": "Done.", "sheet": False}), "luca"], [("anna", "is_entry"), ("anna", "sends_to", "luca"), ("anna", "is_exit")])
    with pytest.raises(NoResult, match="before Anna produced a sheet"):
        await run(workflow)


async def test_the_result_is_the_last_sheet_the_exit_agent_produced():
    # Gianni gets two hand-offs, so two turns: the sheet of the second is the result.
    workflow = office(
        ["anna", agent("luca", script=writes("From Luca", "second")), agent("gianni", script=writes("Seen", "seen: {sheet}"))],
        [("anna", "is_entry"), ("anna", "sends_to", "gianni"), ("anna", "sends_to", "luca"), ("luca", "sends_to", "gianni"), ("gianni", "is_exit")],
    )
    drafts = await run(workflow, "first")
    assert [d.payload["output"] for d in of_type(drafts, T.AGENT_FINISHED, "gianni")] == ["seen: first", "seen: second"]
    # Gianni's first sheet was never handed to anyone: it is in no event, and takes no id.
    assert drafts[-1].payload == {"output": "seen: second", "documentId": "doc_3", "version": 1, "title": "Seen", "authorId": "gianni"}
    assert list(DocumentRegistry.fold(drafts).documents) == ["doc_input", "doc_1", "doc_2", "doc_3"]


async def test_a_later_turn_in_which_the_exit_agent_writes_nothing_leaves_the_result_as_it_was():
    # Gianni is handed the task, then only told something: his second turn has no sheet in it.
    workflow = office(
        ["anna", agent("luca", script={"says": "Nothing to add.", "sheet": False}), "gianni"],
        [("anna", "is_entry"), ("anna", "sends_to", "gianni"), ("anna", "sends_to", "luca"), ("luca", "sends_to", "gianni"), ("gianni", "is_exit")],
    )
    drafts = await run(workflow, "the task")
    assert [d.payload["output"] for d in of_type(drafts, T.AGENT_FINISHED, "gianni")] == ["the task", ""]
    assert drafts[-1].payload == {"output": "the task", "documentId": "doc_input", "version": 1, "title": "Task", "authorId": "gianni"}


async def test_a_result_that_was_also_handed_to_someone_is_that_same_sheet():
    workflow = office(
        [agent("anna", script=writes("Report", "done")), "luca"],
        [("anna", "is_entry"), ("anna", "sends_to", "luca"), ("anna", "is_exit")],
    )
    drafts = await run(workflow)
    assert handed(drafts) == [("luca", "doc_1", 1, "Report")]
    assert (drafts[-1].payload["documentId"], drafts[-1].payload["title"]) == ("doc_1", "Report")
    assert DocumentRegistry.fold(drafts).documents["doc_1"].place.to_wire() == {"kind": "tray", "tray": "out"}


# -- uses_tool: the agent's to call, or consulted first


def consulting(*tools, script=None, **extra):
    """Anna hands the task to Luca, who has the tools given: (name, required) pairs, in order."""
    return office(
        [agent("anna", script={"says": "Look this up."}), agent("luca", **({"script": script} if script else {}))],
        [("anna", "is_entry"), ("anna", "sends_to", "luca")] + [("luca", "uses_tool", name, {"required": required}) for name, required in tools] + [("luca", "is_exit")],
        **extra,
    )


async def test_a_tool_consulted_first_is_called_by_the_runtime_with_what_arrived_and_nobody_decides_it():
    drafts = await run(consulting(("web_search", True)), "sales")
    luca = [d for d in drafts if d.actor_id == "luca"]
    assert [d.type for d in luca] == [T.MESSAGE_RECEIVED, T.AGENT_STARTED, T.TOOL_CALL, T.TOOL_RESULT, T.AGENT_FINISHED]
    turn_input = of_type(drafts, T.AGENT_STARTED, "luca")[0].payload["input"]
    assert turn_input == "Look this up.\nsales"
    assert of_type(drafts, T.TOOL_CALL)[0].payload == {"tool": "web_search", "arguments": {"query": turn_input}, "required": True}
    # It is in what the agent knows before it is asked anything: the scripted agent writes it down.
    assert drafts[-1].payload["output"] == "Sales: €1.2M"
    context = of_type(drafts, T.AGENT_FINISHED, "luca")[0].payload["context"]
    assert [item["kind"] for item in context] == ["system", "message", "document", "tool_call", "tool_result", "sheet"]
    assert context[3] == {"kind": "tool_call", "tool": "web_search", "arguments": {"query": turn_input}, "required": True}


async def test_a_tool_the_agent_may_use_is_its_own_decision():
    drafts = await run(consulting(("web_search", False)), "sales")
    assert [d.type for d in drafts if d.actor_id == "luca"] == [T.MESSAGE_RECEIVED, T.AGENT_STARTED, T.DECISION, T.TOOL_CALL, T.TOOL_RESULT, T.AGENT_FINISHED]
    assert of_type(drafts, T.DECISION, "luca")[0].payload == {"kind": "tool_selection", "summary": "Use web_search to handle the request.", "tool": "web_search"}
    assert "required" not in of_type(drafts, T.TOOL_CALL)[0].payload


async def test_what_is_consulted_is_fetched_in_sentence_order_before_the_agent_uses_anything():
    workflow = office(
        [agent("anna", script=writes("Sum", "1 + 1")), "luca"],
        [
            ("anna", "is_entry"),
            ("anna", "writes_table", "board"),
            ("anna", "sends_to", "luca"),
            ("luca", "uses_tool", "web_search"),
            ("luca", "uses_tool", "calculator", {"required": True}),
            ("luca", "reads_table", "board"),
            ("luca", "is_exit"),
        ],
        tables=[{"id": "board"}],
    )
    drafts = await run(workflow)
    steps = [(d.type, d.payload.get("tool") or d.payload.get("tableId"), d.payload.get("required", False)) for d in drafts if d.actor_id == "luca" and d.type in (T.TOOL_CALL, T.DOCUMENT_READ)]
    assert steps == [(T.TOOL_CALL, "calculator", True), (T.DOCUMENT_READ, "board", False), (T.TOOL_CALL, "web_search", False)]

    first = Workflow.model_validate({**workflow.to_wire(), "relations": [{**r, **({"order": 1} if r["verb"] == "reads_table" else {})} for r in workflow.to_wire()["relations"]]})
    steps = [d.type for d in await run(first) if d.actor_id == "luca" and d.type in (T.TOOL_CALL, T.DOCUMENT_READ)]
    assert steps == [T.DOCUMENT_READ, T.TOOL_CALL, T.TOOL_CALL]


async def test_consulted_tools_count_towards_the_limit_of_tool_calls_in_a_turn():
    both = (("web_search", True), ("calculator", False))
    assert (await run(consulting(*both, budgets={"maxToolCallsPerTurn": 2}), "2 + 2"))[-1].type is T.RUN_FINISHED
    with pytest.raises(BudgetExceeded, match="Luca reached its limit of 1 tool calls"):
        await run(consulting(*both, budgets={"maxToolCallsPerTurn": 1}), "2 + 2")
    with pytest.raises(BudgetExceeded, match="Luca reached its limit of 0 tool calls"):
        await run(consulting(("web_search", True), budgets={"maxToolCallsPerTurn": 0}))


async def test_only_a_tool_with_one_text_argument_can_be_consulted_first():
    events = OfficeRuntime(default_registry()).run(consulting(("send_email", True)), "go")
    assert (await anext(events)).type is T.RUN_STARTED
    with pytest.raises(WorkflowError, match="Luca consults 'send_email' first, but only a tool with exactly one required text argument"):
        await anext(events)
    # The same tool is fine as one the agent may use.
    assert (await run(consulting(("send_email", False))))[-1].type is T.RUN_FINISHED


def test_which_tools_can_be_consulted_first():
    tools = {tool.name: sole_argument(tool.schema) for tool in default_registry().list()}
    assert tools == {"web_search": "query", "send_email": None, "calculator": "expression"}
    text, number = {"type": "string"}, {"type": "number"}
    assert sole_argument({"properties": {"q": text, "limit": {**number, "default": 5}}, "required": ["q"]}) == "q"
    assert sole_argument({"properties": {"n": number}, "required": ["n"]}) is None
    assert sole_argument({"properties": {"q": text}}) is None
    assert sole_argument({"properties": {"a": text, "b": text}, "required": ["a", "b"]}) is None
    assert sole_argument({"required": ["ghost"]}) is None
    assert sole_argument({}) is None


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
    assert stops[0].payload["summary"] == "“Anna hands to Luca” has reached its limit of 5 rounds."
    assert drafts[-1].type is T.RUN_FINISHED
    # One sheet went back and forth the whole time.
    assert {document for _, document, _, _ in handed(drafts)} == {"doc_input"}


async def test_a_relation_can_set_its_own_number_of_rounds():
    drafts = await run(ping_pong(maxRounds=2))
    assert [sender for sender, _, _ in sent(drafts)] == ["anna", "luca", "anna", "luca"]


async def test_a_relation_off_any_cycle_has_no_limit_of_its_own():
    workflow = demo_workflow()
    assert all(Office(workflow).rounds(relation) is None for relation in workflow.relations)
    assert Office(ping_pong()).rounds(ping_pong().relations[1]) == 5


# -- tables


def supplier_board():
    return office(
        [
            agent("anna", script={"says": "Research these.", "sheet": {"title": "Suppliers", "content": "Supplier A\nSupplier B"}}),
            agent("sorter", provider="rule", name="splitter"),
            agent("luca", script=writes("Finding")),
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


async def test_a_splitter_writes_one_sheet_per_line_of_the_sheet_it_holds_and_ignores_what_was_said():
    drafts = await run(supplier_board())
    written = [(d.payload["title"], d.payload["content"]) for d in of_type(drafts, T.DOCUMENT_WRITTEN, "sorter")]
    assert written == [("Supplier A", "Supplier A"), ("Supplier B", "Supplier B")]
    # It produces no sheet of its own.
    assert of_type(drafts, T.AGENT_FINISHED, "sorter")[0].payload["output"] == ""


async def test_a_pile_is_worked_one_sheet_per_turn_oldest_first():
    drafts = await run(supplier_board())
    taken = [(d.payload["documentId"], d.payload["remaining"]) for d in of_type(drafts, T.DOCUMENT_TAKEN, "luca")]
    assert taken == [("doc_2", 1), ("doc_3", 0)]
    turns = of_type(drafts, T.AGENT_STARTED, "luca")
    assert [turn.payload["input"] for turn in turns] == ["Supplier A", "Supplier B"]
    assert [d.payload["arguments"]["query"] for d in of_type(drafts, T.TOOL_CALL, "luca")] == ["Supplier A", "Supplier B"]


async def test_writing_again_on_a_shared_table_makes_a_new_version_of_the_sheet_with_that_title():
    drafts = await run(supplier_board())
    board = [(d.payload["documentId"], d.payload["version"], d.payload["title"]) for d in of_type(drafts, T.DOCUMENT_WRITTEN) if d.payload["tableId"] == "board"]
    assert board == [("doc_5", 1, "Finding"), ("doc_5", 2, "Finding")]
    pile = [d.payload["documentId"] for d in of_type(drafts, T.DOCUMENT_WRITTEN, "luca") if d.payload["tableId"] == "done"]
    assert pile == ["doc_4", "doc_6"]  # a pile gets a new sheet every time, whatever its title


async def test_a_collector_waits_for_the_office_to_go_quiet_then_takes_the_whole_pile():
    drafts = await run(supplier_board())
    order = trace(drafts)
    first_take = order.index((T.DOCUMENT_TAKEN, "stapler", None))
    # Luca has finished both of his turns before the stapler moves.
    assert order.index((T.AGENT_FINISHED, "luca", None), order.index((T.AGENT_FINISHED, "luca", None)) + 1) < first_take
    assert [(d.payload["documentId"], d.payload["remaining"]) for d in of_type(drafts, T.DOCUMENT_TAKEN, "stapler")] == [("doc_4", 1), ("doc_6", 0)]
    assert len(of_type(drafts, T.AGENT_STARTED, "stapler")) == 1
    # Everything it found goes on one new sheet, named after the pile, and it says nothing.
    assert of_type(drafts, T.MESSAGE_SENT, "stapler")[0].payload == {
        "message": "",
        "documentId": "doc_7",
        "version": 1,
        "title": "Researched",
        "content": "Supplier A: reliable, 30 days delivery\nSupplier B: cheaper, 60 days delivery",
    }


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


async def test_an_agent_with_no_sheet_puts_nothing_on_a_table():
    workflow = office(
        [agent("anna", script={"says": "Nothing to report.", "sheet": False}), "luca"],
        [("anna", "is_entry"), ("anna", "writes_table", "board"), ("anna", "sends_to", "luca"), ("luca", "is_exit")],
        tables=[{"id": "board"}],
    )
    with pytest.raises(NoResult):  # Luca, told something and handed nothing, has nothing to deliver either
        await run(workflow)
    events = OfficeRuntime(default_registry()).run(workflow, "go")
    seen = []
    with pytest.raises(NoResult):
        async for draft in events:
            seen.append(draft)
    assert of_type(seen, T.DOCUMENT_WRITTEN) == []
    assert sent(seen) == [("anna", "luca", "Nothing to report.")]


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
    """Whom the router handed to, what it said, and the sheet."""
    return [(d.target_id, d.payload["message"], d.payload.get("documentId"), d.payload.get("content")) for d in of_type(drafts, T.MESSAGE_SENT, "router")]


async def test_a_router_hands_the_sheet_on_unchanged_to_whoever_its_first_matching_rule_names():
    rules = [{"contains": "refund", "to": "gianni"}, {"contains": "invoice", "to": "luca"}]
    drafts = await run(switchboard(rules=rules), "An INVOICE and a Refund")
    # The very sheet it was handed, and not a word of its own.
    assert routed(drafts) == [("gianni", "", "doc_input", "An INVOICE and a Refund")]
    decision = of_type(drafts, T.DECISION, "router")[0].payload
    assert (decision["kind"], decision["relationId"], decision["summary"]) == ("routing", "r4", "The sheet mentions “refund”: for Gianni.")
    # The desk it did not choose never hears of it.
    assert of_type(drafts, T.AGENT_STARTED, "luca") == []
    assert drafts[-1].type is T.RUN_FINISHED


async def test_a_router_falls_back_to_otherwise_then_to_its_first_option():
    rules = [{"contains": "refund", "to": "gianni"}]
    assert routed(await run(switchboard(rules=rules, otherwise="gianni"), "hello")) == [("gianni", "", "doc_input", "hello")]
    drafts = await run(switchboard(rules=rules), "hello")
    assert routed(drafts) == [("luca", "", "doc_input", "hello")]
    assert of_type(drafts, T.DECISION, "router")[0].payload["summary"] == "No rule matches: for Luca."


async def test_a_router_goes_by_the_sheet_not_by_what_was_said_about_it():
    workflow = Workflow.model_validate(switchboard(rules=[{"contains": "refund", "to": "gianni"}]).to_wire())
    workflow.agents[0].model = workflow.agents[0].model.model_copy(update={"script": {"says": "A refund, I think."}})
    assert routed(await run(workflow, "an invoice")) == [("luca", "", "doc_input", "an invoice")]


async def test_a_router_told_something_without_a_sheet_goes_by_the_words_and_repeats_them():
    workflow = Workflow.model_validate(switchboard(rules=[{"contains": "refund", "to": "gianni"}]).to_wire())
    workflow.agents[0].model = workflow.agents[0].model.model_copy(update={"script": {"says": "A refund, please.", "sheet": False}})
    events, seen = OfficeRuntime(default_registry()).run(workflow, "go"), []
    with pytest.raises(NoResult):  # nobody ever writes anything down
        async for draft in events:
            seen.append(draft)
    assert routed(seen) == [("gianni", "A refund, please.", None, None)]
    assert of_type(seen, T.DECISION, "router")[0].payload["summary"] == "The message mentions “refund”: for Gianni."


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
    with pytest.raises(NoResult, match="before Luca produced a sheet"):
        await run(workflow, "a refund")


async def test_an_unknown_rule_is_an_error_of_that_agent():
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
        return sorted((d.type, d.actor_id or "", d.target_id or "", d.payload.get("message", ""), d.payload.get("content", d.payload.get("output"))) for d in drafts if d.type in (T.MESSAGE_SENT, T.AGENT_FINISHED, T.RUN_FINISHED))

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
        (office(["anna"], [("anna", "is_entry"), ("anna", "is_exit"), ("anna", "uses_tool", "teleporter")]), "Anna is given the tool 'teleporter', which this server does not have"),
        (office(["anna"], [("anna", "is_entry"), ("anna", "is_exit"), ("anna", "uses_tool", "teleporter", {"required": True})]), "does not have"),
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
