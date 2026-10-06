from __future__ import annotations

from enum import StrEnum
from typing import Any

from pydantic import ConfigDict, Field, model_serializer, model_validator
from pydantic.alias_generators import to_camel

from server.events.models import CamelModel

SCHEMA_VERSION = 2
DEFAULT_ROOM_ID = "office"
# Several instances of one agent arrive with a later phase; the ceiling is here so files stay sane.
MAX_INSTANCES = 10


class ModelConfiguration(CamelModel):
    # Providers expose different knobs (e.g. the fake model's `script`), so extras pass through.
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="allow")

    provider: str = "fake"
    name: str = "scripted-v1"


class AgentAppearance(CamelModel):
    sprite: str = "agent_male_01"


class Room(CamelModel):
    """A group of agents, stations and tables that works alongside the other rooms."""

    id: str
    name: str = ""


class Agent(CamelModel):
    # Stable identifier, independent from the display name.
    id: str
    name: str
    role: str = ""
    room_id: str = DEFAULT_ROOM_ID
    instances: int = Field(default=1, ge=1, le=MAX_INSTANCES)
    model: ModelConfiguration = Field(default_factory=ModelConfiguration)
    system_prompt: str = ""
    appearance: AgentAppearance = Field(default_factory=AgentAppearance)


class Position(CamelModel):
    x: float = 0
    y: float = 0


class TableMode(StrEnum):
    # One document per title, versioned; readers see the latest.
    SHARED = "shared"
    # A queue of documents; takers consume them one at a time.
    PILE = "pile"


class TableScope(StrEnum):
    ROOM = "room"
    # Visible from every room (the intranet totem).
    GLOBAL = "global"


class WorkflowTable(CamelModel):
    """Where documents are left for random access instead of being handed over."""

    id: str
    name: str = ""
    mode: TableMode = TableMode.SHARED
    scope: TableScope = TableScope.ROOM
    room_id: str = DEFAULT_ROOM_ID


class Verb(StrEnum):
    """What an agent can do. The catalog is closed: each verb has execution semantics in the
    runtime, a rule in the web client's visual mapper and a sentence in its transcript."""

    SENDS_TO = "sends_to"
    WAITS_FOR = "waits_for"
    USES_TOOL = "uses_tool"
    READS_TABLE = "reads_table"
    WRITES_TABLE = "writes_table"
    TAKES_FROM_TABLE = "takes_from_table"
    IS_ENTRY = "is_entry"
    IS_EXIT = "is_exit"


# What the object of each verb must be. None: the verb has no object.
OBJECT_KIND: dict[Verb, str | None] = {
    Verb.SENDS_TO: "agent",
    Verb.WAITS_FOR: "agent",
    Verb.USES_TOOL: "tool",
    Verb.READS_TABLE: "table",
    Verb.WRITES_TABLE: "table",
    Verb.TAKES_FROM_TABLE: "table",
    Verb.IS_ENTRY: None,
    Verb.IS_EXIT: None,
}

# The verbs an agent may or may not act on, turn by turn, when `required` is false.
OPTIONAL_VERBS = frozenset({Verb.SENDS_TO, Verb.WRITES_TABLE})


class Relation(CamelModel):
    """One sentence about an agent: subject, verb, object."""

    id: str
    subject: str
    verb: Verb
    object: str | None = None
    # Only for sends_to and writes_table: false leaves it to the agent, turn by turn.
    required: bool = True
    # Required sends and writes of one subject happen in this order, then in declaration order.
    order: int | None = None
    # How many times this relation may fire in one run. Unset: 5 on a cycle, unlimited otherwise.
    max_rounds: int | None = Field(default=None, ge=1)
    # Shown to the model: when this relation should be chosen.
    hint: str = ""

    @model_serializer(mode="wrap")
    def _as_a_sentence(self, handler: Any) -> dict[str, Any]:
        # On the wire a relation says only what is not the default, so files stay readable.
        data = handler(self)
        if data.get("required") is True:
            del data["required"]
        if data.get("hint") == "":
            del data["hint"]
        return data


class Budgets(CamelModel):
    """Limits that end a run with RUN_ERROR instead of letting it go on forever."""

    max_events: int = Field(default=5000, ge=1)
    max_turns_per_agent: int = Field(default=100, ge=1)
    max_tool_calls_per_turn: int = Field(default=10, ge=0)


class WorkflowLayout(CamelModel):
    """Where things stand in the world. Visual only: the runtime never reads it."""

    positions: dict[str, Position] = Field(default_factory=dict)


def _one_room() -> list[Room]:
    return [Room(id=DEFAULT_ROOM_ID, name="Office")]


class WorkflowDefinition(CamelModel):
    """A workflow as authored in the editor (no server identity yet).

    It may be unfinished: an office with no entry yet is saved like any other. What a run
    needs on top of this is checked when one starts (server.workflow.relations).
    """

    schema_version: int = SCHEMA_VERSION
    name: str = "Untitled workflow"
    # Default task handed to the entry agent when a run does not provide one.
    input: str = ""
    rooms: list[Room] = Field(default_factory=_one_room)
    agents: list[Agent] = Field(default_factory=list)
    tables: list[WorkflowTable] = Field(default_factory=list)
    relations: list[Relation] = Field(default_factory=list)
    budgets: Budgets = Field(default_factory=Budgets)
    layout: WorkflowLayout = Field(default_factory=WorkflowLayout)

    @model_validator(mode="before")
    @classmethod
    def _upgrade(cls, data: Any) -> Any:
        # Files, stored run snapshots and request bodies written for revision 1 are read as they are.
        from server.workflow.migrate import upgrade

        return upgrade(data) if isinstance(data, dict) else data

    @model_validator(mode="after")
    def _check_references(self) -> "WorkflowDefinition":
        if self.schema_version != SCHEMA_VERSION:
            raise ValueError(f"workflow schema version {self.schema_version} is not supported (this server reads {SCHEMA_VERSION})")
        if not self.rooms:
            raise ValueError("a workflow needs at least one room")
        rooms = _unique([room.id for room in self.rooms], "room")
        agents = _unique([agent.id for agent in self.agents], "agent")
        tables = _unique([table.id for table in self.tables], "table")
        _unique([relation.id for relation in self.relations], "relation")
        # Events name agents and tables by bare id, so one id cannot mean both.
        if tables & agents:
            raise ValueError("a table and an agent cannot share an id")
        for agent in self.agents:
            if agent.room_id not in rooms:
                raise ValueError(f"agent {agent.id} is in unknown room {agent.room_id!r}")
        for table in self.tables:
            if table.room_id not in rooms:
                raise ValueError(f"table {table.id} is in unknown room {table.room_id!r}")

        modes = {table.id: table.mode for table in self.tables}
        sentences: set[tuple[str, Verb, str | None]] = set()
        for relation in self.relations:
            if relation.subject not in agents:
                raise ValueError(f"relation {relation.id}: the subject {relation.subject!r} is not an agent")
            kind = OBJECT_KIND[relation.verb]
            if kind is None:
                if relation.object is not None:
                    raise ValueError(f"relation {relation.id}: {relation.verb.value} takes no object")
            elif not relation.object:
                raise ValueError(f"relation {relation.id}: {relation.verb.value} needs an object")
            elif kind == "agent":
                if relation.object not in agents:
                    raise ValueError(f"relation {relation.id}: the object {relation.object!r} is not an agent")
                if relation.object == relation.subject:
                    raise ValueError(f"relation {relation.id}: an agent cannot {relation.verb.value} itself")
            elif kind == "table":
                if relation.object not in tables:
                    raise ValueError(f"relation {relation.id}: the object {relation.object!r} is not a table")
                if relation.verb is Verb.TAKES_FROM_TABLE and modes[relation.object] is not TableMode.PILE:
                    raise ValueError(f"relation {relation.id}: sheets can only be taken from a pile")
                if relation.verb is Verb.READS_TABLE and modes[relation.object] is not TableMode.SHARED:
                    raise ValueError(f"relation {relation.id}: a pile is taken from, not read")
            if not relation.required and relation.verb not in OPTIONAL_VERBS:
                raise ValueError(f"relation {relation.id}: {relation.verb.value} cannot be optional")
            sentence = (relation.subject, relation.verb, relation.object)
            if sentence in sentences:
                raise ValueError(f"relation {relation.id} says the same as an earlier one")
            sentences.add(sentence)
        for verb in (Verb.IS_ENTRY, Verb.IS_EXIT):
            if sum(relation.verb is verb for relation in self.relations) > 1:
                raise ValueError(f"only one agent can be the {'entry' if verb is Verb.IS_ENTRY else 'exit'}")
        return self


def _unique(ids: list[str], what: str) -> set[str]:
    if len(set(ids)) != len(ids):
        raise ValueError(f"{what} ids must be unique")
    return set(ids)


class Workflow(WorkflowDefinition):
    id: str

    def agent(self, agent_id: str) -> Agent:
        return next(agent for agent in self.agents if agent.id == agent_id)

    def table(self, table_id: str) -> WorkflowTable:
        return next(table for table in self.tables if table.id == table_id)


class WorkflowSummary(CamelModel):
    id: str
    name: str
    updated_at: str


class RunStatus(StrEnum):
    RUNNING = "running"
    FINISHED = "finished"
    ERROR = "error"
    # The user stopped it.
    STOPPED = "stopped"
    # The server stopped while the run was in flight; its log has no terminal event.
    INTERRUPTED = "interrupted"


class RunSummary(CamelModel):
    id: str
    workflow_id: str
    status: RunStatus
    input: str
    created_at: str
    finished_at: str | None = None


class Run(RunSummary):
    workflow: Workflow


class RunRequest(CamelModel):
    input: str | None = None


class RunExport(CamelModel):
    """Self-contained saved execution: pipeline, per-agent context and full event log."""

    run: Run
    events: list[dict[str, Any]]
