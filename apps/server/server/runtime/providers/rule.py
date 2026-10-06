from __future__ import annotations

from collections.abc import AsyncGenerator
from typing import Any

from server.runtime.base import AgentRuntimeError
from server.runtime.turn import Sheet, ToolOutcome, TurnContext, TurnProvider, TurnResult, TurnStep, Write, as_text, title_of
from server.workflow.models import Agent, Verb


class RuleProvider(TurnProvider):
    """Agents that follow a rule instead of asking a model. Which rule is `model.name`.

    router     hands the sheet it holds on as it is, saying nothing, to the first of
               `model.rules` whose text the sheet contains (`{"contains": "refund", "to":
               "<agent id>"}`), else to `model.otherwise`, else to the first agent it may
               hand to. Told something without being handed a sheet, it goes by the words
               and repeats them.
    splitter   writes one sheet per line of the sheets it holds on each table it writes on
    collector  waits until the rest of the office has gone quiet, then takes the whole
               pile at once and writes everything it found on one sheet, named after the pile
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
            yield self._collect(turn)
        else:
            raise AgentRuntimeError(f"{turn.agent.name} follows the unknown rule {rule!r}.", turn.agent.id)

    @staticmethod
    def _route(turn: TurnContext) -> TurnResult:
        options = {relation.object: relation for relation in turn.routes if relation.verb is Verb.SENDS_TO}
        extra: dict[str, Any] = turn.agent.model.model_extra or {}
        sheet = turn.sheets[0].id if turn.sheets else None
        what = "sheet" if turn.sheets else "message"

        def to(target: str, reason: str) -> TurnResult:
            relation = options[target]
            return TurnResult(sheet=sheet, says={} if turn.sheets else {relation.id: turn.told}, routes=(relation.id,), rationale=reason)

        text = (turn.held or turn.told).lower()
        for rule in extra.get("rules") or []:
            needle, target = str(rule.get("contains", "")), rule.get("to")
            if needle and needle.lower() in text and target in options:
                return to(target, f"The {what} mentions “{needle}”: for {turn.names.get(target, target)}.")
        fallback = extra.get("otherwise")
        if fallback not in options:
            fallback = next(iter(options), None)
        if fallback is None:
            return TurnResult(sheet=sheet)
        return to(fallback, f"No rule matches: for {turn.names.get(fallback, fallback)}.")

    @staticmethod
    def _split(turn: TurnContext) -> TurnResult:
        lines = [line.strip() for line in (turn.held or turn.told).splitlines() if line.strip()]
        return TurnResult(writes=tuple(Write(relation.id, title_of(line), line) for relation in turn.writes for line in lines))

    @staticmethod
    def _collect(turn: TurnContext) -> TurnResult:
        if not turn.sheets:
            return TurnResult()
        pile = turn.sheets[0].table_id
        title = turn.names.get(pile, pile) if pile else title_of(as_text(turn.sheets[0].content))
        return TurnResult(sheet=Sheet(title, turn.held))
