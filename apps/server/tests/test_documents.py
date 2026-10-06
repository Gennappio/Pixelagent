from office import DEMO_INPUT, run

from server.documents.models import INPUT_DOCUMENT_ID, filed_by, in_hand, in_tray, on_table, out_tray
from server.documents.registry import DocumentRegistry
from server.events.models import AgentEventType as T
from server.events.models import EventDraft
from server.workflow.demo import demo_workflow


async def demo_drafts():
    return await run(demo_workflow(), DEMO_INPUT)


def place_after(drafts, count, document_id):
    document = DocumentRegistry.fold(drafts[:count]).get(document_id)
    return document.place if document else None


def written(actor, table, document_id, version=1, title="Notes", content="…"):
    payload = {"tableId": table, "documentId": document_id, "version": version, "title": title, "content": content}
    return EventDraft(T.DOCUMENT_WRITTEN, actor, payload=payload)


def said(actor, target, message, **sheet_):
    """A hand-off as revision 3 writes it: something said, and a sheet only when there is one."""
    return EventDraft(T.MESSAGE_SENT, actor, target, {"message": message, **sheet_})


async def test_the_demo_passes_three_sheets_along():
    registry = DocumentRegistry.fold(await demo_drafts())

    assert list(registry.documents) == [INPUT_DOCUMENT_ID, "doc_1", "doc_2"]
    summary = [(d.id, d.latest.title, d.latest.author_id, d.latest.content) for d in registry.documents.values()]
    assert summary == [
        ("doc_input", "Task", None, DEMO_INPUT),
        ("doc_1", "Sales number", "luca", "Sales: €1.2M"),
        ("doc_2", "Email sent", "gianni", "Email sent to management@example.com"),
    ]
    # What Anna and Luca said is in the events, and only there.
    assert all(len(document.versions) == 1 for document in registry.documents.values())


async def test_a_sheet_moves_from_tray_to_hand_to_hand_to_the_files():
    drafts = await demo_drafts()
    # 1 RUN_STARTED, 2 AGENT_STARTED anna, 3 MESSAGE_SENT anna→luca, 4 AGENT_FINISHED anna
    assert [drafts[index].type for index in (2, 9)] == [T.MESSAGE_SENT, T.MESSAGE_SENT]
    assert place_after(drafts, 1, "doc_input") == in_tray()
    assert place_after(drafts, 2, "doc_input") == in_hand("anna")
    # Anna passes the task on: it is in Luca's hands, and she has nothing left to file.
    assert place_after(drafts, 3, "doc_input") == in_hand("luca")
    assert place_after(drafts, 4, "doc_input") == in_hand("luca")
    # 10 MESSAGE_SENT luca→gianni: the sheet Luca wrote exists from here on
    assert place_after(drafts, 9, "doc_1") is None
    assert place_after(drafts, 10, "doc_1") == in_hand("gianni")
    # 11 AGENT_FINISHED luca: the task he was working from, and did not pass on, is put away
    assert place_after(drafts, 10, "doc_input") == in_hand("luca")
    assert place_after(drafts, 11, "doc_input") == filed_by("luca")


async def test_only_the_result_is_left_out_at_the_end():
    registry = DocumentRegistry.fold(await demo_drafts())
    places = {document.id: document.place for document in registry.documents.values()}
    assert places == {
        "doc_input": filed_by("luca"),
        "doc_1": filed_by("gianni"),
        "doc_2": out_tray(),
    }
    assert registry.held_by("gianni") == []


async def test_history_records_who_touched_a_sheet():
    registry = DocumentRegistry.fold(await demo_drafts())
    history = [(touch.action, touch.agent_id, touch.peer_id) for touch in registry.get("doc_1").history]
    assert history == [
        ("handed", "luca", "gianni"),
        ("received", "gianni", "luca"),
        ("filed", "gianni", None),
    ]
    assert [touch.action for touch in registry.get("doc_input").history] == ["created", "picked_up", "handed", "received", "filed"]


def test_words_alone_leave_the_documents_as_they_were():
    task = EventDraft(T.RUN_STARTED, payload={"input": "go", "documentId": "doc_input", "title": "Task"})
    before = DocumentRegistry.fold([task]).to_wire()
    spoken = [said("anna", "luca", "Go ahead."), EventDraft(T.MESSAGE_RECEIVED, "luca", "anna", {"message": "Go ahead."})]
    assert DocumentRegistry.fold([task, *spoken]).to_wire() == before


def test_a_sheet_passed_on_changes_hands_and_stays_the_same_document():
    sheet_ = {"documentId": "doc_1", "version": 1, "title": "Notes", "content": "first"}
    registry = DocumentRegistry.fold([said("anna", "luca", "Here.", **sheet_), said("luca", "gianni", "", **sheet_)])
    notes = registry.get("doc_1")
    assert notes.place == in_hand("gianni")
    # Passing it on is not writing it: one version, and Anna is still its author.
    assert [(version.version, version.author_id) for version in notes.versions] == [(1, "anna")]
    assert [(touch.action, touch.agent_id, touch.peer_id) for touch in notes.history] == [("handed", "anna", "luca"), ("handed", "luca", "gianni")]


def test_a_new_version_can_be_written_in_someone_s_hands():
    registry = DocumentRegistry.fold(
        [
            said("anna", "luca", "Check this.", documentId="doc_1", version=1, title="Notes", content="first"),
            said("luca", "gianni", "Checked.", documentId="doc_1", version=2, title="Notes", content="second"),
        ]
    )
    notes = registry.get("doc_1")
    assert [(version.version, version.author_id, version.content) for version in notes.versions] == [(1, "anna", "first"), (2, "luca", "second")]
    assert notes.place == in_hand("gianni")
    assert registry.next_version("doc_1") == 3


def test_a_photocopy_remembers_the_sheet_it_was_copied_from():
    sheet_ = {"version": 1, "title": "Notes", "content": "same"}
    registry = DocumentRegistry.fold(
        [
            said("anna", "luca", "", documentId="doc_1", **sheet_),
            said("anna", "gianni", "", documentId="doc_2", copyOf="doc_1", **sheet_),
        ]
    )
    assert (registry.get("doc_1").copy_of, registry.get("doc_2").copy_of) == (None, "doc_1")
    wire = registry.to_wire()["documents"]
    assert "copyOf" not in wire["doc_1"]
    assert wire["doc_2"]["copyOf"] == "doc_1"
    # A copy is a sheet of its own: each is where it was handed.
    assert (registry.get("doc_1").place, registry.get("doc_2").place) == (in_hand("luca"), in_hand("gianni"))


def test_the_result_can_be_a_sheet_that_already_exists():
    registry = DocumentRegistry.fold(
        [
            said("anna", "luca", "", documentId="doc_1", version=1, title="Notes", content="first"),
            EventDraft(T.AGENT_FINISHED, "luca", payload={"output": "second"}),
            # Luca wrote a new version of what he was handed, and it is the result.
            EventDraft(T.RUN_FINISHED, payload={"output": "second", "documentId": "doc_1", "version": 2, "title": "Notes", "authorId": "luca"}),
        ]
    )
    notes = registry.get("doc_1")
    assert notes.place == out_tray()
    assert [(version.version, version.author_id, version.content) for version in notes.versions] == [(1, "anna", "first"), (2, "luca", "second")]
    assert [touch.action for touch in notes.history] == ["handed", "filed", "delivered"]


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
        T.MESSAGE_RECEIVED, "luca", "anna", {"message": "Hello.", "content": "hello", "documentId": "doc_7", "version": 1, "title": "Note", "copyOf": "doc_3"}
    )
    registry = DocumentRegistry.fold([received])
    assert registry.get("doc_7").latest.author_id == "anna"
    assert registry.get("doc_7").place == in_hand("luca")
    assert registry.get("doc_7").copy_of == "doc_3"


def test_a_hand_off_from_before_messages_had_words_is_a_sheet_and_nothing_else():
    # Revision 2 wrote the words as the content of a sheet made for the occasion.
    old = EventDraft(T.MESSAGE_SENT, "anna", "luca", {"content": "Find the number.", "documentId": "doc_1", "version": 1, "title": "Message to Luca"})
    registry = DocumentRegistry.fold([old])
    assert (registry.get("doc_1").latest.content, registry.get("doc_1").place) == ("Find the number.", in_hand("luca"))


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
