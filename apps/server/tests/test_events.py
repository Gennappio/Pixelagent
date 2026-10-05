import sqlite3

import pytest

from server.events.emitter import EventEmitter
from server.events.models import AgentEvent, AgentEventType, EventDraft


def test_event_serializes_to_camel_case_wire_format():
    event = AgentEvent(
        id="evt_0023",
        run_id="run_001",
        sequence=23,
        timestamp="2026-10-05T14:31:02.432Z",
        type=AgentEventType.MESSAGE_SENT,
        actor_id="anna",
        target_id="luca",
        payload={"content": "Find information about supplier X."},
    )
    wire = event.to_wire()
    assert wire == {
        "id": "evt_0023",
        "runId": "run_001",
        "sequence": 23,
        "timestamp": "2026-10-05T14:31:02.432Z",
        "type": "MESSAGE_SENT",
        "actorId": "anna",
        "targetId": "luca",
        "payload": {"content": "Find information about supplier X."},
    }
    assert AgentEvent.model_validate(wire) == event


def test_optional_actor_and_target_are_omitted_on_the_wire():
    event = AgentEvent(id="e", run_id="r", sequence=1, timestamp="t", type=AgentEventType.RUN_STARTED)
    assert "actorId" not in event.to_wire()
    assert "targetId" not in event.to_wire()


def test_emitter_assigns_gapless_unique_sequences_in_emission_order(events, run):
    emitter = EventEmitter(run.id, events)
    emitted = [emitter.emit(EventDraft(AgentEventType.DECISION, "anna", payload={"n": n})) for n in range(5)]

    assert [event.sequence for event in emitted] == [1, 2, 3, 4, 5]
    assert len({event.id for event in emitted}) == 5
    assert all(event.run_id == run.id for event in emitted)


def test_events_are_persisted_and_read_back_in_sequence_order(events, run):
    emitter = EventEmitter(run.id, events)
    emitted = [emitter.emit(EventDraft(AgentEventType.DECISION, "anna", payload={"n": n})) for n in range(3)]

    assert events.list(run.id) == emitted
    assert events.list(run.id, after=2) == emitted[2:]
    assert events.last_sequence(run.id) == 3


def test_order_does_not_depend_on_timestamps(events, run):
    stamps = iter(["2026-01-01T00:00:03Z", "2026-01-01T00:00:01Z", "2026-01-01T00:00:02Z"])
    emitter = EventEmitter(run.id, events, clock=lambda: next(stamps))
    for n in range(3):
        emitter.emit(EventDraft(AgentEventType.DECISION, "anna", payload={"n": n}))

    assert [event.payload["n"] for event in events.list(run.id)] == [0, 1, 2]


def test_a_new_emitter_continues_the_existing_sequence(events, run):
    EventEmitter(run.id, events).emit(EventDraft(AgentEventType.RUN_STARTED))
    resumed = EventEmitter(run.id, events).emit(EventDraft(AgentEventType.RUN_FINISHED))
    assert resumed.sequence == 2


def test_listeners_see_events_only_after_they_are_stored(events, run):
    seen = []
    emitter = EventEmitter(run.id, events)
    emitter.subscribe(lambda event: seen.append(events.last_sequence(run.id) == event.sequence))
    emitter.emit(EventDraft(AgentEventType.RUN_STARTED))
    assert seen == [True]


def test_duplicate_sequence_is_rejected(events, run):
    event = EventEmitter(run.id, events).emit(EventDraft(AgentEventType.RUN_STARTED))
    with pytest.raises(sqlite3.IntegrityError):
        events.append(event.model_copy(update={"id": "other"}))


def test_event_log_is_append_only(connection, events, run):
    EventEmitter(run.id, events).emit(EventDraft(AgentEventType.RUN_STARTED))
    with pytest.raises(sqlite3.IntegrityError, match="append-only"):
        connection.execute("UPDATE events SET type = 'RUN_ERROR'")
    with pytest.raises(sqlite3.IntegrityError, match="append-only"):
        connection.execute("DELETE FROM events")
