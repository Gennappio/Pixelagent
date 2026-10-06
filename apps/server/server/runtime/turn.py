"""What one agent does in one turn, behind an interface every kind of agent fits.

A provider decides; the runtime acts. The provider never emits events, never mints
document ids and never applies budgets: it asks for tools and, at the end, says what
it produced and where it wants it to go. That keeps a scripted agent, a rule, an LLM
and an external coding agent interchangeable, and keeps every one of them observable
in the same way.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import AsyncGenerator
from dataclasses import dataclass, field
from typing import Any

from server.tools.base import Tool
from server.workflow.models import Agent, Relation

# One entry of an agent's context: {"kind": "system" | "message" | "decision" | "tool_call" | ...}
ContextItem = dict[str, Any]


@dataclass(frozen=True)
class ToolRequest:
    """The provider wants a tool called. It is sent the ToolOutcome in return."""

    tool: str
    arguments: dict[str, Any]
    # Explicit, intentionally emitted rationale. Never hidden model reasoning.
    rationale: str


@dataclass(frozen=True)
class ToolOutcome:
    tool: str
    result: Any
    summary: str


@dataclass(frozen=True)
class Write:
    """One sheet for one of the agent's `writes_table` relations."""

    relation_id: str
    title: str
    content: Any


@dataclass(frozen=True)
class TurnResult:
    """How the turn ends."""

    # What the agent produced. It is what gets handed on, written down, or delivered.
    output: str
    # Ids of the optional relations the agent chooses to act on this turn.
    routes: tuple[str, ...] = ()
    # Why those. Shown as the DECISION that precedes each of them.
    rationale: str = ""
    # Sheets to write, when the agent wants something other than its output on each required table.
    writes: tuple[Write, ...] | None = None


TurnStep = ToolRequest | TurnResult


@dataclass
class TurnContext:
    agent: Agent
    # What the turn starts from: the sheets handed to the agent or taken by it, as text.
    input: str
    # Everything the agent knows so far. The runtime adds tool calls and results as they happen.
    context: list[ContextItem]
    # Tools the agent can use, in the order of its relations.
    tools: list[Tool] = field(default_factory=list)
    # Optional relations (sends_to, writes_table) that can still be acted on this turn.
    routes: list[Relation] = field(default_factory=list)
    # Every writes_table relation of the agent, required or not.
    writes: list[Relation] = field(default_factory=list)
    # Display names of agents and tables, by id.
    names: dict[str, str] = field(default_factory=dict)


class TurnProvider(ABC):
    @abstractmethod
    def run_turn(self, turn: TurnContext) -> AsyncGenerator[TurnStep, ToolOutcome | None]:
        """Yield a ToolRequest for each tool call (and receive its outcome), then one TurnResult."""

    def works_in_batches(self, agent: Agent) -> bool:
        """True for an agent that takes a whole pile at once, when the rest of the office has gone quiet."""
        return False
