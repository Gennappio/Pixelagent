"""Reads workflows written for revision 1 (a node graph) as revision 2 (relations).

Works on plain dicts, before any model is built, so that a file, a run snapshot stored
long ago and a request body are all upgraded the same way. The web client has the same
function for files it opens without the server (apps/web/src/protocol/migrate.ts);
tests/fixtures/workflow_v1.json holds a workflow both must upgrade identically.
"""

from __future__ import annotations

from typing import Any

from server.workflow.models import DEFAULT_ROOM_ID, SCHEMA_VERSION


def is_revision_1(data: dict[str, Any]) -> bool:
    if data.get("schemaVersion", data.get("schema_version")) not in (None, 1):
        return False
    agents = data.get("agents") or []
    return "nodes" in data or "edges" in data or any(isinstance(agent, dict) and "tools" in agent for agent in agents)


def upgrade(data: dict[str, Any]) -> dict[str, Any]:
    """The same workflow in the current schema. Anything already current is returned as it is."""
    if not is_revision_1(data):
        return data

    nodes = {node["id"]: node for node in data.get("nodes") or [] if isinstance(node, dict) and "id" in node}
    edges = [edge for edge in data.get("edges") or [] if isinstance(edge, dict)]

    def kind(node_id: Any) -> str | None:
        return nodes.get(node_id, {}).get("type")

    def agent_of(node_id: Any) -> str | None:
        return nodes.get(node_id, {}).get("agentId") if kind(node_id) == "agent" else None

    sentences: list[dict[str, Any]] = []

    def say(subject: str, verb: str, target: str | None = None) -> None:
        sentence = {"subject": subject, "verb": verb, **({"object": target} if target is not None else {})}
        if sentence not in sentences:
            sentences.append(sentence)

    for edge in edges:
        if kind(edge.get("source")) == "start" and (entry := agent_of(edge.get("target"))):
            say(entry, "is_entry")
            break

    agents = []
    for agent in data.get("agents") or []:
        own = {key: value for key, value in agent.items() if key != "tools"}
        agents.append({**own, "roomId": DEFAULT_ROOM_ID, "instances": 1})
        outgoing = [edge for edge in edges if agent_of(edge.get("source")) == agent["id"]]
        # Tool nodes wired to the agent come first, then tools it only listed: the order the old runtime used.
        for edge in outgoing:
            if kind(edge.get("target")) == "tool" and (tool := nodes[edge["target"]].get("tool")):
                say(agent["id"], "uses_tool", tool)
        for reference in agent.get("tools") or []:
            if isinstance(reference, dict) and reference.get("name"):
                say(agent["id"], "uses_tool", reference["name"])
        for edge in outgoing:
            if (recipient := agent_of(edge.get("target"))) and recipient != agent["id"]:
                say(agent["id"], "sends_to", recipient)

    for edge in edges:
        if kind(edge.get("target")) == "end" and (last := agent_of(edge.get("source"))):
            say(last, "is_exit")
            break

    upgraded: dict[str, Any] = {
        "schemaVersion": SCHEMA_VERSION,
        "name": data.get("name", "Untitled workflow"),
        "input": data.get("input", ""),
        "rooms": [{"id": DEFAULT_ROOM_ID, "name": "Office"}],
        "agents": agents,
        "tables": [{**table, "roomId": table.get("roomId", DEFAULT_ROOM_ID)} for table in data.get("tables") or []],
        "relations": [{"id": f"r{number}", **sentence} for number, sentence in enumerate(sentences, start=1)],
    }
    if "id" in data:
        upgraded["id"] = data["id"]
    return upgraded
