from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import AsyncIterator

from server.events.models import EventDraft
from server.workflow.models import Workflow


class AgentRuntimeError(Exception):
    """A failure of a run, attributable to one agent when `actor_id` is set.

    Surfaces as a RUN_ERROR event whose `errorType` is the name of the class, so each
    way a run can fail has its own subclass.
    """

    def __init__(self, message: str, actor_id: str | None = None) -> None:
        super().__init__(message)
        self.actor_id = actor_id


class ToolError(AgentRuntimeError):
    """A tool raised while an agent was using it."""


class BudgetExceeded(AgentRuntimeError):
    """The run hit one of the workflow's limits."""


class Deadlock(AgentRuntimeError):
    """Nothing can happen any more, and an agent is still waiting for a sheet that will not come."""


class NoResult(AgentRuntimeError):
    """Nothing can happen any more, and the exit agent never produced a sheet: there is no result."""


class AgentRuntime(ABC):
    """Executes a workflow and reports everything it does as events.

    This is the only contract the rest of the system depends on. Framework
    adapters (LangGraph, OpenAI Agents, Claude Code, …) implement it by
    translating their own callbacks into EventDrafts.
    """

    @abstractmethod
    def run(self, workflow: Workflow, run_input: str) -> AsyncIterator[EventDraft]:
        """Yield the run's events in order. Raising ends the run with RUN_ERROR."""
