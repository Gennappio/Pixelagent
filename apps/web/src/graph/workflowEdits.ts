import type { Agent, Position, Workflow, WorkflowNode } from "../protocol/workflow";

// Pure edits of the workflow document. The editor UI and the stores only call these.

function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
}

export function emptyWorkflow(): Workflow {
  return {
    id: "", // assigned by the server on first save
    name: "Untitled workflow",
    input: "",
    agents: [],
    nodes: [
      { id: "start", type: "start", position: { x: 40, y: 40 } },
      { id: "end", type: "end", position: { x: 40, y: 420 } },
    ],
    edges: [],
  };
}

/** Keeps each agent's `tools` in step with the tool nodes wired to it: the graph is the source of truth. */
export function deriveAgentTools(workflow: Workflow): Workflow {
  const nodes = new Map(workflow.nodes.map((node) => [node.id, node]));
  const toolsByAgent = new Map<string, string[]>();
  for (const edge of workflow.edges) {
    const source = nodes.get(edge.source);
    const target = nodes.get(edge.target);
    if (source?.type === "agent" && source.agentId && target?.type === "tool" && target.tool) {
      const tools = toolsByAgent.get(source.agentId) ?? [];
      if (!tools.includes(target.tool)) tools.push(target.tool);
      toolsByAgent.set(source.agentId, tools);
    }
  }
  return {
    ...workflow,
    agents: workflow.agents.map((agent) => ({
      ...agent,
      tools: (toolsByAgent.get(agent.id) ?? []).map((name) => ({ name })),
    })),
  };
}

export function canConnect(workflow: Workflow, sourceId: string, targetId: string): boolean {
  const source = workflow.nodes.find((node) => node.id === sourceId);
  const target = workflow.nodes.find((node) => node.id === targetId);
  if (!source || !target || source.id === target.id) return false;
  if (workflow.edges.some((edge) => edge.source === sourceId && edge.target === targetId)) return false;
  if (source.type === "start") return target.type === "agent";
  if (source.type === "agent") return target.type !== "start";
  return false;
}

export function connect(workflow: Workflow, sourceId: string, targetId: string): Workflow {
  if (!canConnect(workflow, sourceId, targetId)) return workflow;
  return deriveAgentTools({
    ...workflow,
    edges: [...workflow.edges, { id: uid("edge"), source: sourceId, target: targetId }],
  });
}

export function removeEdges(workflow: Workflow, edgeIds: string[]): Workflow {
  return deriveAgentTools({ ...workflow, edges: workflow.edges.filter((edge) => !edgeIds.includes(edge.id)) });
}

/** Removes nodes (never Start/End), their edges, and the agents behind removed agent nodes. */
export function removeNodes(workflow: Workflow, nodeIds: string[]): Workflow {
  const removed = workflow.nodes.filter(
    (node) => nodeIds.includes(node.id) && node.type !== "start" && node.type !== "end",
  );
  const ids = new Set(removed.map((node) => node.id));
  const agentIds = new Set(removed.flatMap((node) => (node.agentId ? [node.agentId] : [])));
  return deriveAgentTools({
    ...workflow,
    agents: workflow.agents.filter((agent) => !agentIds.has(agent.id)),
    nodes: workflow.nodes.filter((node) => !ids.has(node.id)),
    edges: workflow.edges.filter((edge) => !ids.has(edge.source) && !ids.has(edge.target)),
  });
}

export function moveNode(workflow: Workflow, nodeId: string, position: Position): Workflow {
  return {
    ...workflow,
    nodes: workflow.nodes.map((node) => (node.id === nodeId ? { ...node, position } : node)),
  };
}

function freePosition(workflow: Workflow, x: number): Position {
  const lowest = Math.max(0, ...workflow.nodes.filter((node) => node.type !== "end").map((node) => node.position.y));
  return { x, y: lowest + 110 };
}

export function addAgent(workflow: Workflow): { workflow: Workflow; agent: Agent } {
  const agent: Agent = {
    id: uid("agent"),
    name: `Agent ${workflow.agents.length + 1}`,
    role: "Assistant",
    model: { provider: "fake", name: "scripted-v1" },
    systemPrompt: "",
    tools: [],
    appearance: { sprite: "agent_male_01" },
  };
  const node: WorkflowNode = {
    id: uid("node"),
    type: "agent",
    agentId: agent.id,
    position: freePosition(workflow, 0),
  };
  return {
    workflow: { ...workflow, agents: [...workflow.agents, agent], nodes: [...workflow.nodes, node] },
    agent,
  };
}

export function updateAgent(workflow: Workflow, agentId: string, patch: Partial<Omit<Agent, "id" | "tools">>): Workflow {
  return {
    ...workflow,
    agents: workflow.agents.map((agent) => (agent.id === agentId ? { ...agent, ...patch } : agent)),
  };
}

export function addToolNode(workflow: Workflow, tool: string, position?: Position): { workflow: Workflow; node: WorkflowNode } {
  const node: WorkflowNode = { id: uid("node"), type: "tool", tool, position: position ?? freePosition(workflow, 280) };
  return { workflow: { ...workflow, nodes: [...workflow.nodes, node] }, node };
}

/** Gives an agent a tool (adding and wiring a tool node) or takes it away (dropping orphaned nodes). */
export function toggleAgentTool(workflow: Workflow, agentId: string, tool: string): Workflow {
  const agentNode = workflow.nodes.find((node) => node.type === "agent" && node.agentId === agentId);
  if (!agentNode) return workflow;
  const isToolNode = (id: string) => workflow.nodes.some((node) => node.id === id && node.type === "tool" && node.tool === tool);
  const wired = workflow.edges.filter((edge) => edge.source === agentNode.id && isToolNode(edge.target));

  if (wired.length === 0) {
    const offset = workflow.edges.filter((edge) => edge.source === agentNode.id).length * 70;
    const added = addToolNode(workflow, tool, { x: agentNode.position.x + 280, y: agentNode.position.y + 10 + offset });
    return connect(added.workflow, agentNode.id, added.node.id);
  }

  const wiredIds = new Set(wired.map((edge) => edge.id));
  const edges = workflow.edges.filter((edge) => !wiredIds.has(edge.id));
  const orphans = wired.map((edge) => edge.target).filter((id) => !edges.some((edge) => edge.target === id));
  return deriveAgentTools({ ...workflow, edges, nodes: workflow.nodes.filter((node) => !orphans.includes(node.id)) });
}
