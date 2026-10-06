from __future__ import annotations

from collections.abc import AsyncGenerator
from typing import Any

from server.runtime.base import AgentRuntimeError
from server.runtime.turn import ToolOutcome, TurnContext, TurnProvider, TurnResult, TurnStep, Write
from server.workflow.models import Agent, Verb

TITLE_LENGTH = 40


def title_of(text: str) -> str:
    """A short title for a sheet: its first line, cut to length."""
    first = text.strip().splitlines()[0] if text.strip() else ""
    return first if len(first) <= TITLE_LENGTH else first[: TITLE_LENGTH - 1].rstrip() + "…"


class RuleProvider(TurnProvider):
    """Agents that follow a rule instead of asking a model. Which rule is `model.name`.

    router     hands the sheet on unchanged, to the first of `model.rules` whose text it
               contains (`{"contains": "refund", "to": "<agent id>"}`), else to
               `model.otherwise`, else to the first agent it may hand to
    splitter   writes one sheet per line of what it is given on each table it writes on
    collector  waits until the rest of the office has gone quiet, then takes the whole
               pile at once and passes on everything it found as one sheet
    """

    def works_in_batches(self, agent: Agent) -> bool:
        return agent.model.name == "collector"

    async def run_turn(self, turn: TurnContext) -> AsyncGenerator[TurnStep, ToolOutcome | None]:
        rule = turn.agent.model.name
        if rule == "router":
            yield self._route(turn)
        elif rule == "splitter":
            yield self._split(turn)
        elif rule == "collector":
            yield TurnResult(output=turn.input)
        else:
            raise AgentRuntimeError(f"{turn.agent.name} follows the unknown rule {rule!r}.", turn.agent.id)

    @staticmethod
    def _route(turn: TurnContext) -> TurnResult:
        options = {relation.object: relation for relation in turn.routes if relation.verb is Verb.SENDS_TO}
        extra: dict[str, Any] = turn.agent.model.model_extra or {}
        text = turn.input.lower()
        for rule in extra.get("rules") or []:
            needle, target = str(rule.get("contains", "")), rule.get("to")
            if needle and needle.lower() in text and target in options:
                reason = f"The sheet mentions “{needle}”: for {turn.names.get(target, target)}."
                return TurnResult(output=turn.input, routes=(options[target].id,), rationale=reason)
        fallback = extra.get("otherwise")
        if fallback not in options:
            fallback = next(iter(options), None)
        if fallback is None:
            return TurnResult(output=turn.input)
        reason = f"No rule matches: for {turn.names.get(fallback, fallback)}."
        return TurnResult(output=turn.input, routes=(options[fallback].id,), rationale=reason)

    @staticmethod
    def _split(turn: TurnContext) -> TurnResult:
        lines = [line.strip() for line in turn.input.splitlines() if line.strip()]
        writes = tuple(Write(relation.id, title_of(line), line) for relation in turn.writes for line in lines)
        count = len(lines)
        return TurnResult(output=f"{count} sheet{'' if count == 1 else 's'} written.", writes=writes)
