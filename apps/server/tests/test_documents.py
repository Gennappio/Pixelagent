from server.documents.models import INPUT_DOCUMENT_ID, filed_by, in_hand, in_tray, on_table, out_tray
from server.documents.registry import DocumentRegistry
from server.events.models import AgentEventType as T
from server.events.models import EventDraft
from server.runtime.simple_runtime import SimpleRuntime
from server.tools.base import default_registry
from server.workflow.demo import demo_workflow

DEMO_INPUT = "Find the latest sales number and send it to management."


async def demo_drafts():
    return [draft async for draft in SimpleRuntime(default_registry()).run(demo_workflow(), DEMO_INPUT)]


def place_after(drafts, count, document_id):
    document = DocumentRegistry.fold(drafts[:count]).get(document_id)
    return document.place if document else None


def written(actor, table, document_id, version=1, title="Notes", content="…"):
    payload = {"tableId": table, "documentId": document_id, "version": version, "title": title, "content": content}
    return EventDraft(T.DOCUMENT_WRITTEN, actor, payload=payload)


async def test_the_demo_passes_four_sheets_along():
    registry = DocumentRegistry.fold(await demo_drafts())

    assert list(registry.documents) == [INPUT_DOCUMENT_ID, "doc_1", "doc_2", "doc_3"]
    summary = [(d.id, d.latest.title, d.latest.author_id, d.latest.content) for d in registry.documents.values()]
    assert summary == [
        ("doc_input", "Task", None, DEMO_INPUT),
        ("doc_1", "Message to Luca", "anna", "Find the latest sales number."),
        ("doc_2", "Message to Gianni", "luca", "Send this result to management: Sales: €1.2M"),
        ("doc_3", "Result", "gianni", "Email sent to management@example.com"),
    ]


async def test_a_sheet_moves_from_tray_to_hand_to_the_files():
    drafts = await demo_drafts()
    # 1 RUN_STARTED, 2 AGENT_STARTED anna, 4 MESSAGE_SENT anna→luca, 5 AGENT_FINISHED anna
    assert place_after(drafts, 1, "doc_input") == in_tray()
    assert place_after(drafts, 2, "doc_input") == in_hand("anna")
    assert place_after(drafts, 3, "doc_1") is None  # not written yet
    assert place_after(drafts, 4, "doc_1") == in_hand("luca")
    assert place_after(drafts, 4, "doc_input") == in_hand("anna")
    assert place_after(drafts, 5, "doc_input") == filed_by("anna")
    # 13 AGENT_FINISHED luca: the brief he was working from is put away
    assert place_after(drafts, 12, "doc_1") == in_hand("luca")
    assert place_after(drafts, 13, "doc_1") == filed_by("luca")


async def test_only_the_result_is_left_out_at_the_end():
    registry = DocumentRegistry.fold(await demo_drafts())
    places = {document.id: document.place for document in registry.documents.values()}
    assert places == {
        "doc_input": filed_by("anna"),
        "doc_1": filed_by("luca"),
        "doc_2": filed_by("gianni"),
        "doc_3": out_tray(),
    }
    assert registry.held_by("gianni") == []


async def test_history_records_who_touched_a_sheet():
    registry = DocumentRegistry.fold(await demo_drafts())
    history = [(touch.action, touch.agent_id, touch.peer_id) for touch in registry.get("doc_1").history]
    assert history == [
        ("handed", "anna", "luca"),
        ("received", "luca", "anna"),
        ("filed", "luca", None),
    ]
    assert [touch.action for touch in registry.get("doc_input").history] == ["created", "picked_up", "filed"]


def test_writing_the_same_document_again_adds_a_version_and_keeps_its_spot():
    registry = DocumentRegistry.fold(
        [
            written("anna", "board", "doc_1", title="Status", content="first"),
            written("anna", "board", "doc_2", title="Other"),
            written("luca", "board", "doc_1", version=2, title="Status", content="second"),
        ]
    )
    status = registry.get("doc_1")
    assert [(v.version, v.content, v.author_id) for v in status.versions] == [(1, "first", "anna"), (2, "second", "luca")]
    assert status.latest.content == "second"
    assert status.place == on_table("board")
    assert registry.on_table("board") == ["doc_1", "doc_2"]
    assert registry.next_version("doc_1") == 3


def test_replaying_an_event_does_not_duplicate_a_version():
    event = written("anna", "board", "doc_1")
    assert len(DocumentRegistry.fold([event, event]).get("doc_1").versions) == 1


def test_taking_from_a_pile_removes_the_sheet_from_the_table():
    registry = DocumentRegistry.fold(
        [
            written("anna", "todo", "doc_1"),
            written("anna", "todo", "doc_2"),
            EventDraft(T.DOCUMENT_TAKEN, "luca", payload={"tableId": "todo", "documentId": "doc_1", "remaining": 1}),
        ]
    )
    assert registry.on_table("todo") == ["doc_2"]
    assert registry.get("doc_1").place == in_hand("luca")
    assert registry.held_by("luca") == ["doc_1"]


def test_reading_leaves_the_sheet_where_it_is_and_is_remembered():
    registry = DocumentRegistry.fold(
        [
            written("anna", "board", "doc_1"),
            EventDraft(T.DOCUMENT_READ, "luca", payload={"tableId": "board", "documentIds": ["doc_1", "doc_missing"]}),
        ]
    )
    assert registry.get("doc_1").place == on_table("board")
    assert [(t.action, t.agent_id) for t in registry.get("doc_1").history] == [("written", "anna"), ("read", "luca")]
    assert registry.get("doc_missing") is None


def test_a_message_received_without_its_send_still_yields_the_sheet():
    # Across rooms the two halves can be far apart, or a log can start mid-run.
    received = EventDraft(
        T.MESSAGE_RECEIVED, "luca", "anna", {"content": "hello", "documentId": "doc_7", "version": 1, "title": "Note"}
    )
    registry = DocumentRegistry.fold([received])
    assert registry.get("doc_7").latest.author_id == "anna"
    assert registry.get("doc_7").place == in_hand("luca")


def test_events_about_unknown_documents_are_ignored():
    registry = DocumentRegistry.fold(
        [
            EventDraft(T.AGENT_STARTED, "anna", payload={"documentIds": ["doc_nowhere"]}),
            EventDraft(T.DOCUMENT_TAKEN, "anna", payload={"tableId": "todo", "documentId": "doc_nowhere"}),
        ]
    )
    assert registry.documents == {}


def test_a_log_from_before_documents_existed_folds_to_nothing():
    legacy = [
        EventDraft(T.RUN_STARTED, payload={"input": "old"}),
        EventDraft(T.AGENT_STARTED, "anna", payload={"input": "old"}),
        EventDraft(T.MESSAGE_SENT, "anna", "luca", {"content": "old"}),
        EventDraft(T.AGENT_FINISHED, "anna", payload={"output": "old"}),
        EventDraft(T.RUN_FINISHED, payload={"output": "old"}),
    ]
    registry = DocumentRegistry.fold(legacy)
    assert registry.to_wire() == {"documents": {}, "order": [], "tables": {}}


def test_new_ids_continue_from_the_log():
    registry = DocumentRegistry()
    assert registry.next_document_id() == "doc_1"
    registry.apply(EventDraft(T.RUN_STARTED, payload={"input": "x", "documentId": INPUT_DOCUMENT_ID}))
    assert registry.next_document_id() == "doc_1"  # the input does not take a number
    registry.apply(written("anna", "board", "doc_4"))
    assert registry.next_document_id() == "doc_5"
    assert registry.next_version("doc_never_seen") == 1


def test_wire_format_is_camel_case_and_omits_what_is_absent():
    registry = DocumentRegistry.fold([EventDraft(T.RUN_STARTED, payload={"input": "go", "documentId": "doc_input", "title": "Task"})])
    assert registry.to_wire() == {
        "documents": {
            "doc_input": {
                "id": "doc_input",
                "versions": [{"version": 1, "title": "Task", "content": "go"}],
                "place": {"kind": "tray", "tray": "in"},
                "history": [{"action": "created"}],
            }
        },
        "order": ["doc_input"],
        "tables": {},
    }
