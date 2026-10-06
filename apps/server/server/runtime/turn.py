"""What one agent does in one turn, behind an interface every kind of agent fits.

A provider decides; the runtime acts. The provider never emits events, never mints
document ids, never photocopies a sheet and never applies budgets: it asks for tools
and, at the end, says what it wrote, what it says to whom, and which of its optional
ways out it takes. That keeps a scripted agent, a rule, an LLM and an external coding
agent interchangeable, and keeps every one of them observable in the same way.

An agent is one task with three slots, and the runtime fills them: what arrives starts
the turn, what is consulted is fetched before the provider is asked anything, and what
goes out is at most one sheet, with a line for each recipient.
"""

from __future__ import annotations

import json
from abc import ABC, abstractmethod
from collections.abc import AsyncGenerator, Mapping
from dataclasses import dataclass, field
from typing import Any

from server.tools.base import Tool
from server.workflow.models import Agent, Relation, Verb

TITLE_LENGTH = 40


def as_text(content: Any) -> str:
    """A sheet's content as text: a string as it is, anything else as JSON."""
    return content if isinstance(content, str) else json.dumps(content, ensure_ascii=False)


def title_of(text: str) -> str:
    """A short title for a sheet that was given none: its first line, cut to length."""
    first = text.strip().splitlines()[0] if text.strip() else ""
    return first if len(first) <= TITLE_LENGTH else first[: TITLE_LENGTH - 1].rstrip() + "…"


# One entry of an agent's context: {"kind": "system" | "message" | "document" | "tool_call" | ...}
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
class Said:
    """What another agent said when it handed something over."""

    sender: str
    text: str


@dataclass(frozen=True)
class HeldSheet:
    """A sheet in the agent's hands when its turn starts."""

    id: str
    version: int
    title: str
    content: Any
    # Who handed it over. None: the task, or a sheet taken from a pile.
    sender: str | None = None
    # The pile it was taken from, if it was.
    table_id: str | None = None


@dataclass(frozen=True)
class Sheet:
    """What the agent wrote this turn. Under the title of a sheet it holds, it is a new version of that one."""

    title: str
    content: Any


@dataclass(frozen=True)
class Write:
    """One sheet for one of the agent's `writes_table` relations."""

    relation_id: str
    title: str
    content: Any


@dataclass(frozen=True)
class TurnResult:
    """How the turn ends: at most one sheet, and a line for whoever it goes to."""

    # What it wrote; or the id of a sheet it holds, to pass that one on as it is; or nothing.
    sheet: Sheet | str | None = None
    # What it says along each hand-off it acts on, by relation id. Nothing said is allowed.
    says: Mapping[str, str] = field(default_factory=dict)
    # Ids of the optional relations the agent chooses to act on this turn.
    routes: tuple[str, ...] = ()
    # Why those. Shown as the DECISION that precedes each of them.
    rationale: str = ""
    # Only when a table should get something other than `sheet` (the splitter writes many).
    writes: tuple[Write, ...] | None = None


TurnStep = ToolRequest | TurnResult


@dataclass
class TurnContext:
    agent: Agent
    # What arrived, as text: each message, then its sheet, in arrival order.
    input: str
    # Everything the agent knows so far, with what it consults already in it. The runtime
    # adds tool calls and results as they happen.
    context: list[ContextItem]
    # What was said to it, and the sheets it holds, in arrival order.
    messages: list[Said] = field(default_factory=list)
    sheets: list[HeldSheet] = field(default_factory=list)
    # The tools the agent may call if it chooses, in sentence order.
    tools: list[Tool] = field(default_factory=list)
    # Every way out it has this turn, in the order they happen: the required ones, which
    # happen whatever it decides, and the optional ones it can still choose.
    outputs: list[Relation] = field(default_factory=list)
    # Display names of agents and tables, by id.
    names: dict[str, str] = field(default_factory=dict)

    @property
    def held(self) -> str:
        """The sheets it holds, as text."""
        return "\n".join(as_text(sheet.content) for sheet in self.sheets)

    @property
    def told(self) -> str:
        """What was said to it, as text."""
        return "\n".join(said.text for said in self.messages if said.text)

    @property
    def routes(self) -> list[Relation]:
        """The optional ways out: handing to someone, writing on a table."""
        return [relation for relation in self.outputs if not relation.required]

    @property
    def writes(self) -> list[Relation]:
        """Every table it writes on, required or not."""
        return [relation for relation in self.outputs if relation.verb is Verb.WRITES_TABLE]


class TurnProvider(ABC):
    @abstractmethod
    def run_turn(self, turn: TurnContext) -> AsyncGenerator[TurnStep, ToolOutcome | None]:
        """Yield a ToolRequest for each tool call (and receive its outcome), then one TurnResult."""

    def works_in_batches(self, agent: Agent) -> bool:
        """True for an agent that takes a whole pile at once, when the rest of the office has gone quiet."""
        return False
