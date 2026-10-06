// Workflow schema shared with the server (apps/server/server/workflow/models.py).
//
// A workflow is an office: agents, tables, and a list of relations, sentences of the
// form subject, verb, object, that say what each agent does. There is no graph to draw
// by hand; the graph view is derived from the relations.

export const SCHEMA_VERSION = 2;
export const DEFAULT_ROOM_ID = "office";

/** One rule of a router: hand the sheet to `to` when its text contains `contains`. */
export interface RouterRule {
  contains: string;
  to: string;
}

export interface ModelConfiguration {
  /** fake: scripted, no API key. rule: follows a rule instead of asking a model. */
  provider: string;
  /** The model, or for a rule which one: router, splitter, collector. */
  name: string;
  /** Fake provider: `message` is what it says, with {input} / {result}. `title` names the sheets it writes. */
  script?: { message?: string; title?: string };
  /** Router rule. */
  rules?: RouterRule[];
  otherwise?: string;
}

export interface AgentAppearance {
  sprite: string;
}

/** A group of agents, stations and tables that works alongside the other rooms. */
export interface Room {
  id: string;
  name: string;
}

export interface Agent {
  /** Stable identifier, independent from the display name. */
  id: string;
  name: string;
  role: string;
  roomId: string;
  instances: number;
  model: ModelConfiguration;
  systemPrompt: string;
  appearance: AgentAppearance;
}

export interface Position {
  x: number;
  y: number;
}

/** Where documents are left for random access instead of being handed over. */
export interface WorkflowTable {
  id: string;
  name: string;
  /** shared: one versioned document per title. pile: a queue, taken one at a time. */
  mode: "shared" | "pile";
  scope: "room" | "global";
  roomId: string;
}

/** What an agent can do. The catalog is closed: see protocol/relations.ts. */
export type Verb =
  | "sends_to"
  | "waits_for"
  | "uses_tool"
  | "reads_table"
  | "writes_table"
  | "takes_from_table"
  | "is_entry"
  | "is_exit";

/** One sentence about an agent. On the wire it says only what is not the default. */
export interface Relation {
  id: string;
  /** An agent id. */
  subject: string;
  verb: Verb;
  /** An agent id, a tool name or a table id, depending on the verb. Absent for is_entry / is_exit. */
  object?: string;
  /** Absent means true. False, for sends_to and writes_table, leaves it to the agent turn by turn. */
  required?: boolean;
  order?: number;
  /** How many times the relation may fire in one run. Absent: 5 on a cycle, unlimited otherwise. */
  maxRounds?: number;
  /** Shown to the model: when this relation should be chosen. */
  hint?: string;
}

/** Limits that end a run with RUN_ERROR instead of letting it go on forever. */
export interface Budgets {
  maxEvents: number;
  maxTurnsPerAgent: number;
  maxToolCallsPerTurn: number;
}

export interface Workflow {
  id: string;
  schemaVersion: number;
  name: string;
  /** Default task handed to the entry agent. */
  input: string;
  rooms: Room[];
  agents: Agent[];
  tables: WorkflowTable[];
  relations: Relation[];
  budgets: Budgets;
  /** Where things stand in the world. Visual only: the runtime never reads it. */
  layout: { positions: Record<string, Position> };
}

export interface WorkflowSummary {
  id: string;
  name: string;
  updatedAt: string;
}

export type RunStatus = "running" | "finished" | "error" | "stopped" | "interrupted";

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

/** What to call each agent and each table of a workflow, by id. */
export function namesOf(workflow: Workflow): Record<string, string> {
  return Object.fromEntries([
    ...workflow.agents.map((agent) => [agent.id, agent.name]),
    ...workflow.tables.map((table) => [table.id, table.name || table.id]),
  ]);
}

export function toolLabel(tool: string): string {
  return tool
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
