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
        self._tasks: dict[str, asyncio.Task[None]] = {}
        # Runs the user asked to stop, as opposed to ones cut short by the server going down.
        self._stopping: set[str] = set()

    def start(self, workflow: Workflow, run_input: str) -> Run:
        """Create the run and execute it in the background."""
        run = self._runs.create(workflow, run_input)
        task = asyncio.create_task(self.execute(run))
        self._tasks[run.id] = task
        task.add_done_callback(lambda _: self._tasks.pop(run.id, None))
        return run

    def stop(self, run_id: str) -> bool:
        """Ask a run in progress to stop. False when it is not running (any more)."""
        task = self._tasks.get(run_id)
        if task is None or task.done():
            return False
        self._stopping.add(run_id)
        task.cancel()
        return True

    async def execute(self, run: Run) -> None:
        emitter = EventEmitter(run.id, self._events)
        emitter.subscribe(self._streams.publish)
        status = RunStatus.FINISHED
        try:
            async for draft in self._runtime.run(run.workflow, run.input):
                emitter.emit(draft)
                if draft.type is AgentEventType.RUN_ERROR:
                    status = RunStatus.ERROR
        except asyncio.CancelledError:
            if run.id not in self._stopping:
                # The server is going down: the log is left without a terminal event.
                status = RunStatus.INTERRUPTED
                raise
            # A stop is the user's decision, and it is in the log like everything else.
            status = RunStatus.STOPPED
            emitter.emit(
                EventDraft(AgentEventType.RUN_ERROR, payload={"message": "Stopped by the user.", "errorType": "Stopped"})
            )
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
            self._stopping.discard(run.id)
            self._runs.finish(run.id, status)
            self._streams.close(run.id)

    async def wait_idle(self) -> None:
        if self._tasks:
            await asyncio.gather(*self._tasks.values(), return_exceptions=True)
