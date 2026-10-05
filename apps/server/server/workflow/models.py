from __future__ import annotations

from enum import StrEnum
from typing import Any

from pydantic import ConfigDict, Field, model_validator
from pydantic.alias_generators import to_camel

from server.events.models import CamelModel


class ModelConfiguration(CamelModel):
    # Providers expose different knobs (e.g. the fake model's `script`), so extras pass through.
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="allow")

    provider: str = "fake"
    name: str = "scripted-v1"


class ToolReference(CamelModel):
    name: str


class AgentAppearance(CamelModel):
    sprite: str = "agent_male_01"


class Agent(CamelModel):
    # Stable identifier, independent from the display name.
    id: str
    name: str
    role: str = ""
    model: ModelConfiguration = Field(default_factory=ModelConfiguration)
    system_prompt: str = ""
    tools: list[ToolReference] = Field(default_factory=list)
    appearance: AgentAppearance = Field(default_factory=AgentAppearance)


class NodeType(StrEnum):
    START = "start"
    AGENT = "agent"
    TOOL = "tool"
    END = "end"


class Position(CamelModel):
    x: float = 0
    y: float = 0


class WorkflowNode(CamelModel):
    id: str
    type: NodeType
    agent_id: str | None = None
    tool: str | None = None
    position: Position = Field(default_factory=Position)


class WorkflowEdge(CamelModel):
    id: str
    source: str
    target: str


class WorkflowDefinition(CamelModel):
    """A workflow as authored in the editor (no server identity yet)."""

    name: str = "Untitled workflow"
    # Default task handed to the first agent when a run does not provide one.
    input: str = ""
    agents: list[Agent] = Field(default_factory=list)
    nodes: list[WorkflowNode] = Field(default_factory=list)
    edges: list[WorkflowEdge] = Field(default_factory=list)

    @model_validator(mode="after")
    def _check_references(self) -> "WorkflowDefinition":
        agent_ids = [agent.id for agent in self.agents]
        if len(set(agent_ids)) != len(agent_ids):
            raise ValueError("agent ids must be unique")
        node_ids = [node.id for node in self.nodes]
        if len(set(node_ids)) != len(node_ids):
            raise ValueError("node ids must be unique")
        edge_ids = [edge.id for edge in self.edges]
        if len(set(edge_ids)) != len(edge_ids):
            raise ValueError("edge ids must be unique")
        for node in self.nodes:
            if node.type is NodeType.AGENT and node.agent_id not in agent_ids:
                raise ValueError(f"node {node.id} references unknown agent {node.agent_id!r}")
            if node.type is NodeType.TOOL and not node.tool:
                raise ValueError(f"tool node {node.id} has no tool")
        for edge in self.edges:
            if edge.source not in node_ids or edge.target not in node_ids:
                raise ValueError(f"edge {edge.id} references an unknown node")
        return self


class Workflow(WorkflowDefinition):
    id: str

    def agent(self, agent_id: str) -> Agent:
        return next(agent for agent in self.agents if agent.id == agent_id)


class WorkflowSummary(CamelModel):
    id: str
    name: str
    updated_at: str


class RunStatus(StrEnum):
    RUNNING = "running"
    FINISHED = "finished"
    ERROR = "error"
    # The server stopped while the run was in flight; its log has no terminal event.
    INTERRUPTED = "interrupted"


class RunSummary(CamelModel):
    id: str
    workflow_id: str
    status: RunStatus
    input: str
    created_at: str
    finished_at: str | None = None


class Run(RunSummary):
    workflow: Workflow


class RunRequest(CamelModel):
    input: str | None = None


class RunExport(CamelModel):
    """Self-contained saved execution: pipeline, per-agent context and full event log."""

    run: Run
    events: list[dict[str, Any]]
