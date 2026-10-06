from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any


def sole_argument(schema: dict[str, Any]) -> str | None:
    """The name of a tool's one required argument, when it has exactly one and it is a string.

    Such a tool can be consulted first: the runtime can call it by itself, before the agent
    thinks, with what the agent was given as that argument. A tool that needs more than that
    has to be called by someone who decides what to pass.
    """
    required = schema.get("required")
    if not isinstance(required, list) or len(required) != 1:
        return None
    spec = (schema.get("properties") or {}).get(required[0])
    return required[0] if isinstance(spec, dict) and spec.get("type") == "string" else None


class Tool(ABC):
    name: str
    description: str
    # JSON Schema of the arguments object.
    schema: dict[str, Any]

    @abstractmethod
    async def execute(self, args: dict[str, Any]) -> Any:
        """Run the tool. A dict result may carry a short human-readable `summary`."""

    def describe(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "description": self.description,
            "schema": self.schema,
            # Whether an agent can be told to consult it first (a required uses_tool).
            "consultable": sole_argument(self.schema) is not None,
        }


class ToolRegistry:
    def __init__(self, tools: list[Tool] | None = None) -> None:
        self._tools: dict[str, Tool] = {}
        for tool in tools or []:
            self.register(tool)

    def register(self, tool: Tool) -> None:
        self._tools[tool.name] = tool

    def get(self, name: str) -> Tool:
        if name not in self._tools:
            raise KeyError(f"unknown tool {name!r}")
        return self._tools[name]

    def list(self) -> list[Tool]:
        return list(self._tools.values())


def default_registry() -> ToolRegistry:
    from server.tools.calculator import CalculatorTool
    from server.tools.mock_email import MockEmailTool
    from server.tools.mock_search import MockSearchTool

    return ToolRegistry([MockSearchTool(), MockEmailTool(), CalculatorTool()])
