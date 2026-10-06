import { canConsultFirst, isRequired, relationsOf, verbInfo } from "../protocol/relations";
import {
  DEFAULT_ROOM_ID,
  SCHEMA_VERSION,
  type Agent,
  type Relation,
  type ToolDescription,
  type Verb,
  type Workflow,
  type WorkflowTable,
} from "../protocol/workflow";

// Pure edits of the workflow document: the only way build mode changes a workflow.
// Each returns a new workflow, or the same one when there is nothing to change.

function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
}

export function emptyWorkflow(): Workflow {
  return {
    id: "", // assigned by the server on first save
    schemaVersion: SCHEMA_VERSION,
    name: "Untitled workflow",
    input: "",
    rooms: [{ id: DEFAULT_ROOM_ID, name: "Office" }],
    agents: [],
    tables: [],
    relations: [],
    budgets: { maxEvents: 5000, maxTurnsPerAgent: 100, maxToolCallsPerTurn: 10 },
    layout: { positions: {} },
  };
}

// -- agents

export function addAgent(workflow: Workflow): { workflow: Workflow; agent: Agent } {
  const agent: Agent = {
    id: uid("agent"),
    name: `Agent ${workflow.agents.length + 1}`,
    role: "Assistant",
    roomId: workflow.rooms[0]?.id ?? DEFAULT_ROOM_ID,
    instances: 1,
    model: { provider: "fake", name: "scripted-v1" },
    systemPrompt: "",
    appearance: { sprite: "agent_male_01" },
  };
  return { workflow: { ...workflow, agents: [...workflow.agents, agent] }, agent };
}

export function updateAgent(workflow: Workflow, agentId: string, patch: Partial<Omit<Agent, "id">>): Workflow {
  return {
    ...workflow,
    agents: workflow.agents.map((agent) => (agent.id === agentId ? { ...agent, ...patch } : agent)),
  };
}

/** Removes the agent and every sentence that is about it or points at it. */
export function removeAgent(workflow: Workflow, agentId: string): Workflow {
  if (!workflow.agents.some((agent) => agent.id === agentId)) return workflow;
  return {
    ...workflow,
    agents: workflow.agents.filter((agent) => agent.id !== agentId),
    relations: workflow.relations.filter(
      (relation) => relation.subject !== agentId && !(verbInfo(relation.verb).objectKind === "agent" && relation.object === agentId),
    ),
  };
}

// -- tables

export function addTable(workflow: Workflow, mode: WorkflowTable["mode"] = "shared"): { workflow: Workflow; table: WorkflowTable } {
  const table: WorkflowTable = {
    id: uid("table"),
    name: mode === "pile" ? `Pile ${workflow.tables.length + 1}` : `Table ${workflow.tables.length + 1}`,
    mode,
    scope: "room",
    roomId: workflow.rooms[0]?.id ?? DEFAULT_ROOM_ID,
  };
  return { workflow: { ...workflow, tables: [...workflow.tables, table] }, table };
}

/** A relation with a table that the table's mode allows: a pile is taken from, a shared table is read. */
function suits(verb: Verb, mode: WorkflowTable["mode"]): boolean {
  if (verb === "takes_from_table") return mode === "pile";
  if (verb === "reads_table") return mode === "shared";
  return true;
}

/** Changes a table. Turning it into the other kind drops the sentences that no longer make sense. */
export function updateTable(workflow: Workflow, tableId: string, patch: Partial<Omit<WorkflowTable, "id">>): Workflow {
  const tables = workflow.tables.map((table) => (table.id === tableId ? { ...table, ...patch } : table));
  const mode = tables.find((table) => table.id === tableId)?.mode;
  if (!mode) return workflow;
  return {
    ...workflow,
    tables,
    relations: workflow.relations.filter(
      (relation) => !(verbInfo(relation.verb).objectKind === "table" && relation.object === tableId && !suits(relation.verb, mode)),
    ),
  };
}

export function removeTable(workflow: Workflow, tableId: string): Workflow {
  if (!workflow.tables.some((table) => table.id === tableId)) return workflow;
  return {
    ...workflow,
    tables: workflow.tables.filter((table) => table.id !== tableId),
    relations: workflow.relations.filter((relation) => !(verbInfo(relation.verb).objectKind === "table" && relation.object === tableId)),
  };
}

// -- relations

/**
 * How a sentence is said beyond subject, verb and object. `required` set against the verb's
 * default says the other thing: "if it chooses" for handing over and writing, "consults
 * first" for a tool. `tools` are the ones the server listed, which is how it is known
 * whether a tool can be consulted first at all.
 */
export interface Saying {
  required?: boolean;
  tools?: readonly ToolDescription[];
}

/** A tool consulted first: only one the server says can be. */
function consultsFirst(verb: Verb, how: Saying): boolean {
  return verb === "uses_tool" && how.required === true;
}

/** What a new sentence "subject verb …" could end with: everything of the right kind not already said. */
export function objectChoices(workflow: Workflow, subject: string, verb: Verb, how: Saying = {}): { id: string; label: string }[] {
  const taken = new Set(relationsOf(workflow, subject, verb).map((relation) => relation.object));
  switch (verbInfo(verb).objectKind) {
    case "agent":
      return workflow.agents.filter((agent) => agent.id !== subject && !taken.has(agent.id)).map((agent) => ({ id: agent.id, label: agent.name }));
    case "tool":
      return (how.tools ?? [])
        .filter((tool) => !taken.has(tool.name) && (!consultsFirst(verb, how) || tool.consultable === true))
        .map((tool) => ({ id: tool.name, label: tool.name }));
    case "table":
      return workflow.tables
        .filter((table) => suits(verb, table.mode) && !taken.has(table.id))
        .map((table) => ({ id: table.id, label: table.name || table.id }));
    default:
      return [];
  }
}

/** Whether "subject verb object" is a sentence the workflow can take: the server applies the same rules. */
export function canRelate(workflow: Workflow, subject: string, verb: Verb, object?: string, how: Saying = {}): boolean {
  if (!workflow.agents.some((agent) => agent.id === subject)) return false;
  const kind = verbInfo(verb).objectKind;
  if (kind === null) return object === undefined && !relationsOf(workflow, subject, verb).length;
  if (!object) return false;
  if (relationsOf(workflow, subject, verb).some((relation) => relation.object === object)) return false;
  if (kind === "agent") return object !== subject && workflow.agents.some((agent) => agent.id === object);
  if (kind === "table") {
    const table = workflow.tables.find((candidate) => candidate.id === object);
    return table !== undefined && suits(verb, table.mode);
  }
  // A tool: which ones exist is the server's knowledge, and so is which can be consulted first.
  return !consultsFirst(verb, how) || canConsultFirst(how.tools ?? [], object);
}

function nextRelationId(workflow: Workflow): string {
  const numbers = workflow.relations.map((relation) => /^r(\d+)$/.exec(relation.id)).flatMap((match) => (match ? [Number(match[1])] : []));
  return `r${Math.max(0, ...numbers) + 1}`;
}

/** `required` as a relation carries it: left unsaid when it is the verb's default, or means nothing on the verb. */
function said(verb: Verb, required: boolean | undefined): { required?: boolean } {
  const byDefault = verbInfo(verb).requiredByDefault;
  return byDefault === undefined || required === undefined || required === byDefault ? {} : { required };
}

/**
 * Adds a sentence, after the ones the same agent already has. Only one agent can be the
 * entry and only one the exit: giving that to an agent takes it from whoever had it.
 */
export function addRelation(workflow: Workflow, subject: string, verb: Verb, object?: string, how: Saying = {}): Workflow {
  if (!canRelate(workflow, subject, verb, object, how)) return workflow;
  const relation: Relation = { id: nextRelationId(workflow), subject, verb, ...(object === undefined ? {} : { object }), ...said(verb, how.required) };
  const kept = verbInfo(verb).objectKind === null ? workflow.relations.filter((other) => other.verb !== verb) : workflow.relations;
  const last = kept.map((other) => other.subject).lastIndexOf(subject);
  const at = last < 0 ? kept.length : last + 1;
  return { ...workflow, relations: [...kept.slice(0, at), relation, ...kept.slice(at)] };
}

export function removeRelation(workflow: Workflow, relationId: string): Workflow {
  if (!workflow.relations.some((relation) => relation.id === relationId)) return workflow;
  return { ...workflow, relations: workflow.relations.filter((relation) => relation.id !== relationId) };
}

/**
 * Changes what a sentence adds to its subject, verb and object. Defaults are left unsaid, as
 * on the wire. A tool that cannot be consulted first is not made to be: pass the server's
 * `tools`, without which no tool can.
 */
export function updateRelation(
  workflow: Workflow,
  relationId: string,
  patch: { required?: boolean; maxRounds?: number | undefined; hint?: string },
  tools: readonly ToolDescription[] = [],
): Workflow {
  const current = workflow.relations.find((relation) => relation.id === relationId);
  if (!current) return workflow;
  if (consultsFirst(current.verb, patch) && !isRequired(current) && !canConsultFirst(tools, current.object)) return workflow;
  return {
    ...workflow,
    relations: workflow.relations.map((relation) => {
      if (relation.id !== relationId) return relation;
      const { required: _was, ...rest } = { ...relation, ...patch };
      const next: Relation = { ...rest, ...said(relation.verb, "required" in patch ? patch.required : relation.required) };
      if (!next.hint) delete next.hint;
      if (!next.maxRounds || next.maxRounds < 1) delete next.maxRounds;
      return next;
    }),
  };
}

/**
 * Moves a sentence up (-1) or down (+1) among the sentences of the same agent in the same
 * slot. That is where order means something: what is consulted enters the context in that
 * order, and what goes out happens in it.
 */
export function moveRelation(workflow: Workflow, relationId: string, direction: -1 | 1): Workflow {
  const index = workflow.relations.findIndex((relation) => relation.id === relationId);
  if (index < 0) return workflow;
  const { subject, verb } = workflow.relations[index];
  const slot = verbInfo(verb).slot;
  const beside = (relation: Relation) => relation.subject === subject && verbInfo(relation.verb).slot === slot;
  let other = index + direction;
  while (other >= 0 && other < workflow.relations.length && !beside(workflow.relations[other])) other += direction;
  if (other < 0 || other >= workflow.relations.length) return workflow;
  const relations = [...workflow.relations];
  [relations[index], relations[other]] = [relations[other], relations[index]];
  return { ...workflow, relations };
}
