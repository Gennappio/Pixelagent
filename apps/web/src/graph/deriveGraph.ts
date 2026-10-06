import { entryOf, exitOf, isRequired, phraseOf, toolsInUse, verbInfo } from "../protocol/relations";
import type { Position, Verb, Workflow } from "../protocol/workflow";

// The workflow as a node graph. Nothing here is stored: the graph is worked out from the
// relations every time, so it cannot disagree with them. Positions too are computed, the
// same way each time for the same workflow.

export type GraphNode =
  | { id: string; kind: "agent"; agentId: string; position: Position }
  | { id: string; kind: "tool"; tool: string; position: Position }
  | { id: string; kind: "table"; tableId: string; position: Position }
  | { id: string; kind: "start" | "end"; position: Position };

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  /** What kind of line to draw. `entry` and `exit` join an agent to START and END. */
  verb: Verb;
  label: string;
  /** Left to the agent, turn by turn: drawn dashed. */
  optional: boolean;
}

export interface DerivedGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

const COLUMN = 270;
const ROW = 120;

export const agentNode = (id: string) => `agent:${id}`;
export const toolNode = (name: string) => `tool:${name}`;
export const tableNode = (id: string) => `table:${id}`;

/** How many hand-offs from the entry each agent is; agents nothing leads to come after all the others. */
function depths(workflow: Workflow): Map<string, number> {
  const depth = new Map<string, number>();
  const entry = entryOf(workflow)?.id ?? workflow.agents[0]?.id;
  let frontier = entry ? [entry] : [];
  for (let level = 0; frontier.length > 0; level++) {
    const next: string[] = [];
    for (const id of frontier) {
      if (depth.has(id)) continue;
      depth.set(id, level);
      for (const relation of workflow.relations) {
        if (relation.subject === id && relation.verb === "sends_to" && relation.object && !depth.has(relation.object)) next.push(relation.object);
      }
    }
    frontier = next;
  }
  const beyond = Math.max(-1, ...depth.values()) + 1;
  for (const agent of workflow.agents) if (!depth.has(agent.id)) depth.set(agent.id, beyond);
  return depth;
}

export function deriveGraph(workflow: Workflow): DerivedGraph {
  const depth = depths(workflow);
  const rows = new Map<number, number>();
  const at = new Map<string, Position>();
  for (const agent of workflow.agents) {
    const column = depth.get(agent.id) ?? 0;
    const row = rows.get(column) ?? 0;
    rows.set(column, row + 1);
    at.set(agent.id, { x: column * COLUMN, y: row * ROW });
  }
  const below = Math.max(1, ...rows.values()) * ROW + 30;

  const nodes: GraphNode[] = workflow.agents.map((agent) => ({ id: agentNode(agent.id), kind: "agent", agentId: agent.id, position: at.get(agent.id)! }));
  toolsInUse(workflow).forEach((tool, index) => nodes.push({ id: toolNode(tool), kind: "tool", tool, position: { x: index * 200, y: below } }));
  workflow.tables.forEach((table, index) => nodes.push({ id: tableNode(table.id), kind: "table", tableId: table.id, position: { x: index * 200, y: below + ROW } }));

  const edges: GraphEdge[] = [];
  const entry = entryOf(workflow);
  const exit = exitOf(workflow);
  if (entry) nodes.push({ id: "start", kind: "start", position: { x: at.get(entry.id)!.x - 170, y: at.get(entry.id)!.y + 12 } });
  if (exit) nodes.push({ id: "end", kind: "end", position: { x: at.get(exit.id)!.x + 250, y: at.get(exit.id)!.y + 12 } });

  for (const relation of workflow.relations) {
    const info = verbInfo(relation.verb);
    const subject = agentNode(relation.subject);
    const edge = { id: relation.id, verb: relation.verb, label: phraseOf(relation), optional: !isRequired(relation) };
    if (relation.verb === "is_entry") edges.push({ ...edge, source: "start", target: subject, label: "" });
    else if (relation.verb === "is_exit") edges.push({ ...edge, source: subject, target: "end", label: "" });
    else if (!relation.object) continue;
    else if (info.objectKind === "agent") edges.push({ ...edge, source: subject, target: agentNode(relation.object) });
    else if (info.objectKind === "tool") edges.push({ ...edge, source: subject, target: toolNode(relation.object) });
    else edges.push({ ...edge, source: subject, target: tableNode(relation.object) });
  }
  return { nodes, edges };
}
