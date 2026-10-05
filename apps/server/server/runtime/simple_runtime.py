from __future__ import annotations

import asyncio
import json
import time
from collections.abc import AsyncIterator
from typing import Any

from server.events.models import AgentEventType as T
from server.events.models import EventDraft
from server.runtime.base import AgentRuntime, AgentRuntimeError
from server.runtime.model import AgentModel, ContextItem, FakeModel
from server.tools.base import ToolRegistry
from server.workflow.models import Agent, Workflow
from server.workflow.plan import build_plan


def summarize(result: Any) -> str:
    if isinstance(result, dict) and isinstance(result.get("summary"), str):
        return result["summary"]
    return result if isinstance(result, str) else json.dumps(result, ensure_ascii=False)


def elapsed_ms(started: float) -> int:
    return round((time.perf_counter() - started) * 1000)


class SimpleRuntime(AgentRuntime):
    """Sequential hand-off runtime: each agent uses its tools, then briefs the next one.

    `pace` is a pause (seconds) between steps so a live run is watchable. It only
    stretches execution time; visualization time is the frontend's business.
    """

    def __init__(
        self,
        tools: ToolRegistry,
        models: dict[str, AgentModel] | None = None,
        pace: float = 0.0,
    ) -> None:
        self._tools = tools
        self._models = models or {"fake": FakeModel()}
        self._pace = pace

    def _model_for(self, agent: Agent) -> AgentModel:
        model = self._models.get(agent.model.provider)
        if model is None:
            raise AgentRuntimeError(f"unknown model provider {agent.model.provider!r}", actor_id=agent.id)
        return model

    async def run(self, workflow: Workflow, run_input: str) -> AsyncIterator[EventDraft]:
        yield EventDraft(
            T.RUN_STARTED,
            payload={"workflowId": workflow.id, "workflowName": workflow.name, "input": run_input},
        )
        steps = build_plan(workflow)

        message = run_input
        sender: Agent | None = None
        for index, step in enumerate(steps):
            agent = step.agent
            recipient = steps[index + 1].agent if index + 1 < len(steps) else None
            model = self._model_for(agent)
            started = time.perf_counter()

            if sender is not None:
                yield EventDraft(T.MESSAGE_RECEIVED, agent.id, sender.id, {"content": message})
            await asyncio.sleep(self._pace)
            yield EventDraft(
                T.AGENT_STARTED,
                agent.id,
                payload={"input": message, "role": agent.role, "model": agent.model.to_wire()},
            )

            context: list[ContextItem] = [
                {"kind": "system", "content": agent.system_prompt},
                {"kind": "message", "from": sender.id if sender else "user", "content": message},
            ]

            for tool_name in step.tools:
                try:
                    tool = self._tools.get(tool_name)
                except KeyError as exc:
                    raise AgentRuntimeError(f"{agent.name} has no access to tool {tool_name!r}", agent.id) from exc
                plan = await model.plan_tool_call(agent, tool, context)
                context.append({"kind": "decision", "content": plan.rationale})
                yield EventDraft(
                    T.DECISION,
                    agent.id,
                    payload={"kind": "tool_selection", "summary": plan.rationale, "tool": tool.name},
                )
                await asyncio.sleep(self._pace)

                context.append({"kind": "tool_call", "tool": tool.name, "arguments": plan.arguments})
                yield EventDraft(T.TOOL_CALL, agent.id, payload={"tool": tool.name, "arguments": plan.arguments})
                tool_started = time.perf_counter()
                await asyncio.sleep(self._pace)
                try:
                    result = await tool.execute(plan.arguments)
                except Exception as exc:
                    raise AgentRuntimeError(f"{tool.name} failed: {exc}", agent.id) from exc
                summary = summarize(result)
                context.append({"kind": "tool_result", "tool": tool.name, "result": result, "summary": summary})
                yield EventDraft(
                    T.TOOL_RESULT,
                    agent.id,
                    payload={
                        "tool": tool.name,
                        "result": result,
                        "summary": summary,
                        "metrics": {"latencyMs": elapsed_ms(tool_started)},
                    },
                )
                await asyncio.sleep(self._pace)

            output = await model.compose_message(agent, context, recipient)
            if recipient is not None:
                rationale = f"Hand off to {recipient.name}."
                context.append({"kind": "decision", "content": rationale})
                yield EventDraft(
                    T.DECISION,
                    agent.id,
                    payload={"kind": "handoff", "summary": rationale, "target": recipient.id},
                )
                await asyncio.sleep(self._pace)
                context.append({"kind": "message_out", "to": recipient.id, "content": output})
                yield EventDraft(T.MESSAGE_SENT, agent.id, recipient.id, {"content": output})
            else:
                context.append({"kind": "output", "content": output})

            # The full context snapshot makes each agent's state at hand-off part of the saved log.
            yield EventDraft(
                T.AGENT_FINISHED,
                agent.id,
                payload={
                    "output": output,
                    "context": context,
                    "metrics": {"durationMs": elapsed_ms(started), "model": agent.model.name},
                },
            )
            message, sender = output, agent

        yield EventDraft(T.RUN_FINISHED, payload={"output": message})
