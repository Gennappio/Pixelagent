from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import AsyncIterator

from server.events.models import EventDraft
from server.workflow.models import Workflow


class AgentRuntimeError(Exception):
    """A failure attributable to one agent. Surfaces as a RUN_ERROR event."""

    def __init__(self, message: str, actor_id: str | None = None) -> None:
        super().__init__(message)
        self.actor_id = actor_id


class AgentRuntime(ABC):
    """Executes a workflow and reports everything it does as events.

    This is the only contract the rest of the system depends on. Framework
    adapters (LangGraph, OpenAI Agents, Claude Code, …) implement it by
    translating their own callbacks into EventDrafts.
    """

    @abstractmethod
    def run(self, workflow: Workflow, run_input: str) -> AsyncIterator[EventDraft]:
        """Yield the run's events in order. Raising ends the run with RUN_ERROR."""
