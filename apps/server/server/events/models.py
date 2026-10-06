"""Core event protocol.

Every runtime interaction becomes an AgentEvent. The schema is deliberately
free of framework-specific concepts: adapters translate into it.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    """Snake_case in Python, camelCase on the wire."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    def to_wire(self) -> dict[str, Any]:
        return self.model_dump(by_alias=True, exclude_none=True, mode="json")


class AgentEventType(StrEnum):
    RUN_STARTED = "RUN_STARTED"
    AGENT_STARTED = "AGENT_STARTED"
    AGENT_FINISHED = "AGENT_FINISHED"
    MESSAGE_SENT = "MESSAGE_SENT"
    MESSAGE_RECEIVED = "MESSAGE_RECEIVED"
    DECISION = "DECISION"
    TOOL_CALL = "TOOL_CALL"
    TOOL_RESULT = "TOOL_RESULT"
    # A document placed on a table, read there, or taken from it.
    DOCUMENT_WRITTEN = "DOCUMENT_WRITTEN"
    DOCUMENT_READ = "DOCUMENT_READ"
    DOCUMENT_TAKEN = "DOCUMENT_TAKEN"
    RUN_FINISHED = "RUN_FINISHED"
    RUN_ERROR = "RUN_ERROR"


TERMINAL_EVENT_TYPES = frozenset({AgentEventType.RUN_FINISHED, AgentEventType.RUN_ERROR})


class AgentEvent(CamelModel):
    id: str
    run_id: str
    # Replay order is defined by sequence, never by timestamp alone.
    sequence: int
    timestamp: str
    type: AgentEventType
    actor_id: str | None = None
    target_id: str | None = None
    payload: dict[str, Any] = Field(default_factory=dict)


@dataclass(frozen=True)
class EventDraft:
    """What a runtime yields. Identity and ordering are stamped by the emitter."""

    type: AgentEventType
    actor_id: str | None = None
    target_id: str | None = None
    payload: dict[str, Any] = field(default_factory=dict)
