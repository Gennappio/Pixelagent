"""Small offices for tests: a workflow in a few lines."""

from __future__ import annotations

from typing import Any

from server.runtime.office_runtime import OfficeRuntime
from server.tools.base import default_registry
from server.workflow.models import Workflow

DEMO_INPUT = "Find the latest sales number and send it to management."


def agent(agent_id: str, **model: Any) -> dict[str, Any]:
    """An agent named after its id. Keyword arguments go into its model (script=..., provider=..., name=...)."""
    return {"id": agent_id, "name": agent_id.capitalize(), "model": {"provider": "fake", "name": "scripted-v1", **model}}


def office(agents: list[Any], sentences: list[Any], tables: list[dict[str, Any]] | None = None, **extra: Any) -> Workflow:
    """`sentences` are (subject, verb[, object[, extra fields]]) tuples; agents may be given as bare ids."""
    relations = []
    for number, (subject, verb, *rest) in enumerate(sentences, start=1):
        relation = {"id": f"r{number}", "subject": subject, "verb": verb}
        if rest and rest[0] is not None:
            relation["object"] = rest[0]
        if len(rest) > 1:
            relation.update(rest[1])
        relations.append(relation)
    return Workflow.model_validate(
        {
            "id": "test",
            "name": "Test office",
            "agents": [agent(entry) if isinstance(entry, str) else entry for entry in agents],
            "tables": tables or [],
            "relations": relations,
            **extra,
        }
    )


async def run(workflow: Workflow, run_input: str = "go", concurrency: int = 1) -> list[Any]:
    return [draft async for draft in OfficeRuntime(default_registry(), concurrency=concurrency).run(workflow, run_input)]


def without_metrics(drafts: list[Any]) -> list[Any]:
    return [(d.type, d.actor_id, d.target_id, {k: v for k, v in d.payload.items() if k != "metrics"}) for d in drafts]
