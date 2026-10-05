from __future__ import annotations

import os
import uuid
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect

from server.events.models import TERMINAL_EVENT_TYPES
from server.runtime.base import AgentRuntime
from server.runtime.simple_runtime import SimpleRuntime
from server.storage.database import connect
from server.storage.event_repository import EventRepository
from server.storage.run_repository import RunRepository
from server.storage.workflow_repository import WorkflowRepository
from server.tools.base import default_registry
from server.websocket.manager import RunStreamManager
from server.workflow.demo import DEMO_WORKFLOW_ID, WORKFLOWS_DIR, demo_workflow
from server.workflow.executor import WorkflowExecutor
from server.workflow.models import (
    Run,
    RunExport,
    RunRequest,
    RunStatus,
    RunSummary,
    Workflow,
    WorkflowDefinition,
    WorkflowSummary,
)

DEFAULT_DB_PATH = Path(__file__).resolve().parent.parent / "data" / "pixelagents.db"


def create_app(
    db_path: str | Path | None = None,
    runtime: AgentRuntime | None = None,
    workflows_dir: str | Path | None = None,
) -> FastAPI:
    connection = connect(db_path or os.environ.get("PIXELAGENTS_DB", DEFAULT_DB_PATH))
    workflows = WorkflowRepository(workflows_dir or os.environ.get("PIXELAGENTS_WORKFLOWS", WORKFLOWS_DIR))
    runs = RunRepository(connection)
    events = EventRepository(connection)
    streams = RunStreamManager()
    tools = default_registry()
    runtime = runtime or SimpleRuntime(tools, pace=float(os.environ.get("PIXELAGENTS_PACE", "0.3")))
    executor = WorkflowExecutor(runtime, runs, events, streams)

    runs.interrupt_running()
    if workflows.get(DEMO_WORKFLOW_ID) is None:
        workflows.save(demo_workflow())

    app = FastAPI(title="Pixel Agents")
    app.state.executor = executor

    def require_workflow(workflow_id: str) -> Workflow:
        workflow = workflows.get(workflow_id)
        if workflow is None:
            raise HTTPException(404, f"workflow {workflow_id} not found")
        return workflow

    def require_run(run_id: str) -> Run:
        run = runs.get(run_id)
        if run is None:
            raise HTTPException(404, f"run {run_id} not found")
        return run

    @app.get("/tools")
    def list_tools() -> list[dict[str, Any]]:
        return [tool.describe() for tool in tools.list()]

    @app.get("/workflows", response_model_exclude_none=True)
    def list_workflows() -> list[WorkflowSummary]:
        return workflows.list()

    @app.post("/workflows", status_code=201, response_model_exclude_none=True)
    def create_workflow(definition: WorkflowDefinition) -> Workflow:
        workflow = Workflow(id=f"wf_{uuid.uuid4().hex[:12]}", **definition.model_dump())
        workflows.save(workflow)
        return workflow

    @app.get("/workflows/{workflow_id}", response_model_exclude_none=True)
    def get_workflow(workflow_id: str) -> Workflow:
        return require_workflow(workflow_id)

    @app.put("/workflows/{workflow_id}", response_model_exclude_none=True)
    def update_workflow(workflow_id: str, definition: WorkflowDefinition) -> Workflow:
        require_workflow(workflow_id)
        workflow = Workflow(id=workflow_id, **definition.model_dump())
        workflows.save(workflow)
        return workflow

    @app.post("/workflows/{workflow_id}/run", status_code=202, response_model_exclude_none=True)
    async def run_workflow(workflow_id: str, request: RunRequest | None = None) -> Run:
        workflow = require_workflow(workflow_id)
        run_input = request.input if request and request.input is not None else workflow.input
        return executor.start(workflow, run_input)

    @app.get("/runs", response_model_exclude_none=True)
    def list_runs(workflow_id: str | None = None) -> list[RunSummary]:
        return runs.list(workflow_id)

    @app.get("/runs/{run_id}", response_model_exclude_none=True)
    def get_run(run_id: str) -> Run:
        return require_run(run_id)

    @app.get("/runs/{run_id}/events")
    def get_run_events(run_id: str, after: int = 0) -> list[dict[str, Any]]:
        require_run(run_id)
        return [event.to_wire() for event in events.list(run_id, after)]

    @app.get("/runs/{run_id}/export", response_model_exclude_none=True)
    def export_run(run_id: str) -> RunExport:
        run = require_run(run_id)
        return RunExport(run=run, events=[event.to_wire() for event in events.list(run_id)])

    @app.websocket("/runs/{run_id}/stream")
    async def stream_run(websocket: WebSocket, run_id: str, after: int = 0) -> None:
        """Send the stored events after `after`, then live ones until the run ends."""
        await websocket.accept()
        # Subscribe before reading the log so nothing emitted in between is lost.
        queue = streams.subscribe(run_id)
        try:
            run = runs.get(run_id)
            if run is None:
                await websocket.close(code=4404, reason="run not found")
                return
            last = after
            done = run.status is not RunStatus.RUNNING
            for event in events.list(run_id, after):
                await websocket.send_json(event.to_wire())
                last = event.sequence
                done = done or event.type in TERMINAL_EVENT_TYPES
            while not done:
                event = await queue.get()
                if event is None:
                    break
                if event.sequence <= last:
                    continue
                await websocket.send_json(event.to_wire())
                last = event.sequence
                done = event.type in TERMINAL_EVENT_TYPES
            await websocket.close()
        except WebSocketDisconnect:
            pass
        finally:
            streams.unsubscribe(run_id, queue)

    return app

