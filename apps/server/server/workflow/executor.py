from __future__ import annotations

import asyncio
import logging

from server.events.emitter import EventEmitter
from server.events.models import AgentEventType, EventDraft
from server.runtime.base import AgentRuntime
from server.storage.event_repository import EventRepository
from server.storage.run_repository import RunRepository
from server.websocket.manager import RunStreamManager
from server.workflow.models import Run, RunStatus, Workflow

logger = logging.getLogger(__name__)


class WorkflowExecutor:
    """Drives a runtime and turns what it yields into the persisted, streamed event log."""

    def __init__(
        self,
        runtime: AgentRuntime,
        runs: RunRepository,
        events: EventRepository,
        streams: RunStreamManager,
    ) -> None:
        self._runtime = runtime
        self._runs = runs
        self._events = events
        self._streams = streams
        self._tasks: set[asyncio.Task[None]] = set()

    def start(self, workflow: Workflow, run_input: str) -> Run:
        """Create the run and execute it in the background."""
        run = self._runs.create(workflow, run_input)
        task = asyncio.create_task(self.execute(run))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        return run

    async def execute(self, run: Run) -> None:
        emitter = EventEmitter(run.id, self._events)
        emitter.subscribe(self._streams.publish)
        status = RunStatus.FINISHED
        try:
            async for draft in self._runtime.run(run.workflow, run.input):
                emitter.emit(draft)
                if draft.type is AgentEventType.RUN_ERROR:
                    status = RunStatus.ERROR
        except Exception as exc:  # errors are events too: the debugger must show them
            logger.info("run %s failed: %s", run.id, exc)
            status = RunStatus.ERROR
            emitter.emit(
                EventDraft(
                    AgentEventType.RUN_ERROR,
                    actor_id=getattr(exc, "actor_id", None),
                    payload={"message": str(exc), "errorType": type(exc).__name__},
                )
            )
        finally:
            self._runs.finish(run.id, status)
            self._streams.close(run.id)

    async def wait_idle(self) -> None:
        if self._tasks:
            await asyncio.gather(*self._tasks, return_exceptions=True)
