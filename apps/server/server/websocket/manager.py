from __future__ import annotations

import asyncio
from collections import defaultdict

from server.events.models import AgentEvent

# None marks the end of a run's stream.
StreamItem = AgentEvent | None


class RunStreamManager:
    """Fans live events out to the WebSocket subscribers of each run."""

    def __init__(self) -> None:
        self._subscribers: dict[str, set[asyncio.Queue[StreamItem]]] = defaultdict(set)

    def subscribe(self, run_id: str) -> asyncio.Queue[StreamItem]:
        queue: asyncio.Queue[StreamItem] = asyncio.Queue()
        self._subscribers[run_id].add(queue)
        return queue

    def unsubscribe(self, run_id: str, queue: asyncio.Queue[StreamItem]) -> None:
        self._subscribers[run_id].discard(queue)
        if not self._subscribers[run_id]:
            del self._subscribers[run_id]

    def publish(self, event: AgentEvent) -> None:
        for queue in self._subscribers.get(event.run_id, ()):
            queue.put_nowait(event)

    def close(self, run_id: str) -> None:
        for queue in self._subscribers.get(run_id, ()):
            queue.put_nowait(None)
