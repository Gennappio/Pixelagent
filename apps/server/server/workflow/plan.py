"""Turns the authored graph into the linear execution plan the MVP supports."""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass

from server.workflow.models import Agent, NodeType, Workflow


class WorkflowError(Exception):
    """The workflow graph cannot be executed as drawn."""


@dataclass(frozen=True)
class AgentStep:
    agent: Agent
    tools: list[str]


def build_plan(workflow: Workflow) -> list[AgentStep]:
    """Follow Start → agent → … → End. Tool nodes attached to an agent become its tools."""
    nodes = {node.id: node for node in workflow.nodes}
    successors: dict[str, list[str]] = defaultdict(list)
    for edge in workflow.edges:
        successors[edge.source].append(edge.target)

    starts = [node for node in workflow.nodes if node.type is NodeType.START]
    if len(starts) != 1:
        raise WorkflowError(f"workflow needs exactly one Start node, found {len(starts)}")

    steps: list[AgentStep] = []
    visited: set[str] = set()
    current = starts[0]
    while True:
        visited.add(current.id)
        next_nodes = [nodes[target] for target in successors[current.id]]
        flow = [node for node in next_nodes if node.type in (NodeType.AGENT, NodeType.END)]
        label = workflow.agent(current.agent_id).name if current.agent_id else "Start"
        if not flow:
            raise WorkflowError(f"{label} is not connected to an agent or to End")
        if len(flow) > 1:
            raise WorkflowError(f"{label} has several outgoing paths; branching is not supported yet")
        following = flow[0]
        if following.type is NodeType.END:
            break
        if following.id in visited:
            raise WorkflowError("workflow contains a cycle; loops are not supported yet")

        agent = workflow.agent(following.agent_id)
        tools = [node.tool for node in (nodes[t] for t in successors[following.id]) if node.type is NodeType.TOOL]
        tools += [ref.name for ref in agent.tools if ref.name not in tools]
        steps.append(AgentStep(agent=agent, tools=list(dict.fromkeys(tools))))
        current = following

    if not steps:
        raise WorkflowError("workflow has no agents between Start and End")
    return steps
