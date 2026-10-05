from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any


class Tool(ABC):
    name: str
    description: str
    # JSON Schema of the arguments object.
    schema: dict[str, Any]

    @abstractmethod
    async def execute(self, args: dict[str, Any]) -> Any:
        """Run the tool. A dict result may carry a short human-readable `summary`."""

    def describe(self) -> dict[str, Any]:
        return {"name": self.name, "description": self.description, "schema": self.schema}


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
