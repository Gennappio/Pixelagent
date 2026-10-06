import { DEFAULT_ROOM_ID, SCHEMA_VERSION, type Agent, type Relation, type Verb, type Workflow, type WorkflowTable } from "./workflow";

// Reads workflows written for revision 1 (a node graph) as revision 2 (relations).
//
// The server does this for everything it loads (apps/server/server/workflow/migrate.py).
// This copy is for what the browser opens without the server: a run exported long ago.
// tests/fixtures/workflow_v1.json holds workflows both must upgrade identically.

type Loose = Record<string, any>;

const DEFAULT_BUDGETS = { maxEvents: 5000, maxTurnsPerAgent: 100, maxToolCallsPerTurn: 10 };

export function isRevision1(data: Loose): boolean {
  const version = data.schemaVersion ?? data.schema_version;
  if (version !== undefined && version !== null && version !== 1) return false;
  const agents: Loose[] = Array.isArray(data.agents) ? data.agents : [];
  return "nodes" in data || "edges" in data || agents.some((agent) => agent && typeof agent === "object" && "tools" in agent);
}

function agentOf(agent: Loose): Agent {
  return {
    id: agent.id,
    name: agent.name,
    role: agent.role ?? "",
    roomId: agent.roomId ?? DEFAULT_ROOM_ID,
    instances: agent.instances ?? 1,
    model: { provider: "fake", name: "scripted-v1", ...(agent.model ?? {}) },
    systemPrompt: agent.systemPrompt ?? "",
    appearance: { sprite: agent.appearance?.sprite ?? "agent_male_01" },
  };
}

function tableOf(table: Loose): WorkflowTable {
  return {
    id: table.id,
    name: table.name ?? "",
    mode: table.mode ?? "shared",
    scope: table.scope ?? "room",
    roomId: table.roomId ?? DEFAULT_ROOM_ID,
  };
}

/** A workflow in the current schema, with every field the rest of the interface relies on. */
function complete(data: Loose, agents: Agent[], relations: Relation[]): Workflow {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: data.id ?? "",
    name: data.name ?? "Untitled workflow",
    input: data.input ?? "",
    rooms: Array.isArray(data.rooms) && data.rooms.length > 0 ? data.rooms : [{ id: DEFAULT_ROOM_ID, name: "Office" }],
    agents,
    tables: (Array.isArray(data.tables) ? data.tables : []).map(tableOf),
    relations,
    budgets: { ...DEFAULT_BUDGETS, ...(data.budgets ?? {}) },
    layout: { positions: data.layout?.positions ?? {} },
  };
}

/** The same workflow in the current schema. One already current only has its gaps filled in. */
export function upgradeWorkflow(data: Loose): Workflow {
  const listed: Loose[] = Array.isArray(data.agents) ? data.agents : [];
  if (!isRevision1(data)) return complete(data, listed.map(agentOf), Array.isArray(data.relations) ? data.relations : []);

  const nodes = new Map<string, Loose>((Array.isArray(data.nodes) ? data.nodes : []).filter((node: Loose) => node?.id).map((node: Loose) => [node.id, node]));
  const edges: Loose[] = (Array.isArray(data.edges) ? data.edges : []).filter((edge: Loose) => edge && typeof edge === "object");
  const kind = (id: unknown): string | undefined => nodes.get(id as string)?.type;
  const agentAt = (id: unknown): string | undefined => (kind(id) === "agent" ? nodes.get(id as string)?.agentId : undefined);

  const sentences: Omit<Relation, "id">[] = [];
  const said = new Set<string>();
  const say = (subject: string, verb: Verb, object?: string) => {
    const key = `${subject}|${verb}|${object ?? ""}`;
    if (said.has(key)) return;
    said.add(key);
    sentences.push(object === undefined ? { subject, verb } : { subject, verb, object });
  };

  const entry = edges.map((edge) => (kind(edge.source) === "start" ? agentAt(edge.target) : undefined)).find(Boolean);
  if (entry) say(entry, "is_entry");

  for (const agent of listed) {
    const outgoing = edges.filter((edge) => agentAt(edge.source) === agent.id);
    // Tool nodes wired to the agent come first, then tools it only listed: the order the old runtime used.
    for (const edge of outgoing) {
      const tool = kind(edge.target) === "tool" ? nodes.get(edge.target)?.tool : undefined;
      if (tool) say(agent.id, "uses_tool", tool);
    }
    for (const reference of Array.isArray(agent.tools) ? agent.tools : []) {
      if (reference?.name) say(agent.id, "uses_tool", reference.name);
    }
    for (const edge of outgoing) {
      const recipient = agentAt(edge.target);
      if (recipient && recipient !== agent.id) say(agent.id, "sends_to", recipient);
    }
  }

  const last = edges.map((edge) => (kind(edge.target) === "end" ? agentAt(edge.source) : undefined)).find(Boolean);
  if (last) say(last, "is_exit");

  // Revision 1 knew nothing of rooms, budgets or a layout: those are the defaults.
  const { rooms: _rooms, budgets: _budgets, layout: _layout, ...rest } = data;
  return complete(
    rest,
    listed.map((agent) => agentOf({ ...agent, roomId: DEFAULT_ROOM_ID, instances: 1 })),
    sentences.map((sentence, index) => ({ id: `r${index + 1}`, ...sentence })),
  );
}
