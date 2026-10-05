from __future__ import annotations

from collections.abc import Callable
from datetime import datetime, timezone

from server.events.models import AgentEvent, EventDraft
from server.storage.event_repository import EventRepository

Listener = Callable[[AgentEvent], None]


def utc_timestamp() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


class EventEmitter:
    """Stamps drafts with id/sequence/timestamp, persists them, then notifies listeners.

    One emitter per run: it is the only writer of that run's sequence.
    """

    def __init__(
        self,
        run_id: str,
        repository: EventRepository,
        clock: Callable[[], str] = utc_timestamp,
    ) -> None:
        self.run_id = run_id
        self._repository = repository
        self._clock = clock
        self._sequence = repository.last_sequence(run_id)
        self._listeners: list[Listener] = []

    def subscribe(self, listener: Listener) -> None:
        self._listeners.append(listener)

    def emit(self, draft: EventDraft) -> AgentEvent:
        sequence = self._sequence + 1
        event = AgentEvent(
            id=f"evt_{self.run_id.removeprefix('run_')}_{sequence:04d}",
            run_id=self.run_id,
            sequence=sequence,
            timestamp=self._clock(),
            type=draft.type,
            actor_id=draft.actor_id,
            target_id=draft.target_id,
            payload=draft.payload,
        )
        # Persist first: a listener must never see an event that is not in the log.
        self._repository.append(event)
        self._sequence = sequence
        for listener in self._listeners:
            listener(event)
        return event
