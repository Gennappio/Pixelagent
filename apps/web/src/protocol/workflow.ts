// Workflow schema shared with the server (apps/server/server/workflow/models.py).

export interface ModelConfiguration {
  provider: string;
  name: string;
  /** Fake provider only: outgoing message template with {input} / {result}. */
  script?: { message?: string };
}

export interface ToolReference {
  name: string;
}

export interface AgentAppearance {
  sprite: string;
}

export interface Agent {
  /** Stable identifier, independent from the display name. */
  id: string;
  name: string;
  role: string;
  model: ModelConfiguration;
  systemPrompt: string;
  tools: ToolReference[];
  appearance: AgentAppearance;
}

export type NodeType = "start" | "agent" | "tool" | "end";

export interface Position {
  x: number;
  y: number;
}

export interface WorkflowNode {
  id: string;
  type: NodeType;
  agentId?: string;
  tool?: string;
  position: Position;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
}

export interface Workflow {
  id: string;
  name: string;
  /** Default task handed to the first agent. */
  input: string;
  agents: Agent[];
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export interface WorkflowSummary {
  id: string;
  name: string;
  updatedAt: string;
}

export type RunStatus = "running" | "finished" | "error" | "interrupted";

export interface RunSummary {
  id: string;
  workflowId: string;
  status: RunStatus;
  input: string;
  createdAt: string;
  finishedAt?: string;
}

export interface Run extends RunSummary {
  /** The workflow exactly as it was executed. */
  workflow: Workflow;
}

export interface ToolDescription {
  name: string;
  description: string;
  schema: Record<string, unknown>;
}

export function toolLabel(tool: string): string {
  return tool
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
