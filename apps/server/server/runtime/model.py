"""What an agent's model decides during its turn, behind a provider-neutral interface."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any

from server.tools.base import Tool
from server.workflow.models import Agent

# One entry of an agent's context: {"kind": "system" | "message" | "decision" | "tool_call" | ...}
ContextItem = dict[str, Any]


@dataclass(frozen=True)
class ToolPlan:
    # Explicit, intentionally emitted rationale. Never hidden model reasoning.
    rationale: str
    arguments: dict[str, Any]


class AgentModel(ABC):
    @abstractmethod
    async def plan_tool_call(self, agent: Agent, tool: Tool, context: list[ContextItem]) -> ToolPlan:
        """Decide how to call `tool` given what the agent knows so far."""

    @abstractmethod
    async def compose_message(self, agent: Agent, context: list[ContextItem], recipient: Agent | None) -> str:
        """Write the agent's outgoing message (or final output when there is no recipient)."""


def last_of(context: list[ContextItem], kind: str) -> ContextItem | None:
    return next((item for item in reversed(context) if item["kind"] == kind), None)


class FakeModel(AgentModel):
    """Deterministic stand-in for an LLM.

    Tool arguments come from the tool schema (defaults, then the incoming
    message for string fields). The outgoing message is `model.script.message`
    with `{input}` / `{result}` placeholders, or a sensible default.
    """

    async def plan_tool_call(self, agent: Agent, tool: Tool, context: list[ContextItem]) -> ToolPlan:
        incoming = (last_of(context, "message") or {}).get("content", "")
        arguments: dict[str, Any] = {}
        for key, spec in tool.schema.get("properties", {}).items():
            if "default" in spec:
                arguments[key] = spec["default"]
            elif spec.get("type") == "string":
                arguments[key] = incoming
        return ToolPlan(rationale=f"Use {tool.name} to handle the request.", arguments=arguments)

    async def compose_message(self, agent: Agent, context: list[ContextItem], recipient: Agent | None) -> str:
        incoming = (last_of(context, "message") or {}).get("content", "")
        result = (last_of(context, "tool_result") or {}).get("summary", "")
        script = (agent.model.model_extra or {}).get("script") or {}
        template = script.get("message") if isinstance(script, dict) else None
        if template:
            return str(template).replace("{input}", incoming).replace("{result}", result)
        return result or incoming
