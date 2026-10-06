from __future__ import annotations

from collections.abc import AsyncGenerator
from typing import Any

from server.runtime.turn import Sheet, ToolOutcome, ToolRequest, TurnContext, TurnProvider, TurnResult, TurnStep, title_of
from server.workflow.models import Verb


def script_of(turn: TurnContext) -> dict[str, Any]:
    script = (turn.agent.model.model_extra or {}).get("script")
    return script if isinstance(script, dict) else {}


class FakeProvider(TurnProvider):
    """Deterministic stand-in for an LLM, so the whole product works with no API key.

    It calls every tool it may use, once and in order. Arguments come from the tool's
    schema: defaults where there are any, and for the other text fields the sheets it
    holds, or what it was told when it holds none.

    What it writes and says is `model.script`:

        sheet   {"title": ..., "content": ...}: the sheet it writes. Under the title of a
                sheet it holds, that is a new version of it. `false`: it writes nothing and
                only talks. Left out: the result of its last tool if it used one, else the
                first sheet it holds, passed on as it is.
        says    one line said to everyone it hands to, or a line per recipient
                ({"<agent id>": ...}). Left out: nothing, and the sheet speaks for itself.

    {input} (everything that arrived), {sheet} (the sheets it holds) and {result} (what its
    last tool returned, consulted ones included) are filled in. `message`, from before a
    hand-off had words of its own, still works: it is the content of the sheet.

    Of the things it may or may not do, it does the first.
    """

    async def run_turn(self, turn: TurnContext) -> AsyncGenerator[TurnStep, ToolOutcome | None]:
        given = turn.held or turn.told
        for tool in turn.tools:
            arguments: dict[str, Any] = {}
            for key, spec in tool.schema.get("properties", {}).items():
                if "default" in spec:
                    arguments[key] = spec["default"]
                elif spec.get("type") == "string":
                    arguments[key] = given
            yield ToolRequest(tool.name, arguments, f"Use {tool.name} to handle the request.")

        # The runtime has put every result into the context, those of consulted tools too.
        results = [item.get("summary", "") for item in turn.context if item.get("kind") == "tool_result"]
        result = str(results[-1]) if results else ""

        def fill(template: Any) -> str:
            return str(template).replace("{input}", turn.input).replace("{sheet}", turn.held).replace("{result}", result)

        script = script_of(turn)
        scripted = script.get("sheet")
        sheet: Sheet | str | None
        if isinstance(scripted, dict):
            content = fill(scripted.get("content", ""))
            sheet = Sheet(fill(scripted["title"]) if scripted.get("title") else title_of(content), content)
        elif scripted is False:
            sheet = None
        elif script.get("message"):
            content = fill(script["message"])
            sheet = Sheet(title_of(content), content)
        elif results:
            sheet = Sheet(title_of(result), result)
        else:
            sheet = turn.sheets[0].id if turn.sheets else None

        chosen = turn.routes[:1]
        target = turn.names.get(chosen[0].object or "", chosen[0].object) if chosen else ""
        lines = script.get("says")
        says = {
            relation.id: fill(lines.get(relation.object, "") if isinstance(lines, dict) else lines or "")
            for relation in turn.outputs
            if relation.verb is Verb.SENDS_TO and (relation.required or relation in chosen)
        }
        yield TurnResult(
            sheet=sheet,
            says=says,
            routes=tuple(relation.id for relation in chosen),
            rationale=f"The first option available: {target}." if chosen else "",
        )
