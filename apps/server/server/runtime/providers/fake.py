from __future__ import annotations

from collections.abc import AsyncGenerator
from typing import Any

from server.runtime.turn import ToolOutcome, TurnContext, TurnProvider, TurnResult, TurnStep, ToolRequest


def script_of(turn: TurnContext) -> dict[str, Any]:
    script = (turn.agent.model.model_extra or {}).get("script")
    return script if isinstance(script, dict) else {}


class FakeProvider(TurnProvider):
    """Deterministic stand-in for an LLM, so the whole product works with no API key.

    It uses every tool it has, once and in order: arguments come from the tool schema
    (defaults, then the incoming text for string fields). What it says is
    `model.script.message` with `{input}` and `{result}` filled in, or by default the
    last tool result, or failing that what it was given. Of the things it may or may
    not do, it does the first.
    """

    async def run_turn(self, turn: TurnContext) -> AsyncGenerator[TurnStep, ToolOutcome | None]:
        outcomes: list[ToolOutcome] = []
        for tool in turn.tools:
            arguments: dict[str, Any] = {}
            for key, spec in tool.schema.get("properties", {}).items():
                if "default" in spec:
                    arguments[key] = spec["default"]
                elif spec.get("type") == "string":
                    arguments[key] = turn.input
            outcome = yield ToolRequest(tool.name, arguments, f"Use {tool.name} to handle the request.")
            if outcome is not None:
                outcomes.append(outcome)

        result = outcomes[-1].summary if outcomes else ""
        template = script_of(turn).get("message")
        output = str(template).replace("{input}", turn.input).replace("{result}", result) if template else (result or turn.input)

        chosen = turn.routes[:1]
        target = turn.names.get(chosen[0].object or "", chosen[0].object) if chosen else ""
        yield TurnResult(
            output=output,
            routes=tuple(relation.id for relation in chosen),
            rationale=f"The first option available: {target}." if chosen else "",
        )
