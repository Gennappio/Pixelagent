import type { Position, Workflow } from "../protocol/workflow";

export const ROOM = { width: 640, height: 400, wall: 56 };

export interface LayoutAgent {
  id: string;
  name: string;
  role: string;
  sprite: string;
}

export interface LayoutTable {
  id: string;
  name: string;
  mode: "shared" | "pile";
}

/** Where things stand in the room. Derived from the workflow alone, so it is reproducible. */
export interface WorldLayout {
  agents: LayoutAgent[];
  tools: string[];
  homes: Record<string, Position>;
  stations: Record<string, Position>;
  /** The in-tray stands by the agent that receives the task, the out-tray by the one that delivers the result. */
  trays: { in?: Position; out?: Position };
  tables: LayoutTable[];
  tablePositions: Record<string, Position>;
}

/** How far to the side of an agent its tray stands. */
const TRAY_OFFSET = 40;

function spread(count: number, index: number, from: number, to: number): number {
  return from + ((to - from) * (index + 1)) / (count + 1);
}

/** The agent Start leads to and the agent that leads to End, as far as the graph says. */
export function terminalAgents(workflow: Workflow): { entry?: string; exit?: string } {
  const node = (id: string | undefined) => workflow.nodes.find((candidate) => candidate.id === id);
  const start = workflow.nodes.find((candidate) => candidate.type === "start");
  const end = workflow.nodes.find((candidate) => candidate.type === "end");
  const first = workflow.edges.find((edge) => edge.source === start?.id && node(edge.target)?.type === "agent");
  const last = workflow.edges.find((edge) => edge.target === end?.id && node(edge.source)?.type === "agent");
  return { entry: node(first?.target)?.agentId, exit: node(last?.source)?.agentId };
}

export function buildLayout(workflow: Workflow): WorldLayout {
  const agents = workflow.agents.map(({ id, name, role, appearance }) => ({
    id,
    name,
    role,
    sprite: appearance.sprite,
  }));
  const tools = [
    ...new Set([
      ...workflow.nodes.flatMap((node) => (node.type === "tool" && node.tool ? [node.tool] : [])),
      ...workflow.agents.flatMap((agent) => agent.tools.map((tool) => tool.name)),
    ]),
  ];
  const tables = (workflow.tables ?? []).map(({ id, name, mode }) => ({ id, name: name || id, mode }));

  // Tables take the front of the room, so the agents stand a little further back.
  const front = tables.length > 0 ? 250 : 280;
  const homes: Record<string, Position> = {};
  agents.forEach((agent, index) => {
    homes[agent.id] = {
      x: Math.round(spread(agents.length, index, 20, ROOM.width - 20)),
      // Alternate rows so neighbours do not overlap when there are many agents.
      y: agents.length > 4 && index % 2 === 1 ? front + 60 : front,
    };
  });

  const stations: Record<string, Position> = {};
  tools.forEach((tool, index) => {
    stations[tool] = { x: Math.round(spread(tools.length, index, 60, ROOM.width - 60)), y: ROOM.wall + 44 };
  });

  const { entry, exit } = terminalAgents(workflow);
  const trays: WorldLayout["trays"] = {};
  if (entry && homes[entry]) trays.in = { x: homes[entry].x - TRAY_OFFSET, y: homes[entry].y + 6 };
  if (exit && homes[exit]) trays.out = { x: homes[exit].x + TRAY_OFFSET, y: homes[exit].y + 6 };

  const tablePositions: Record<string, Position> = {};
  tables.forEach((table, index) => {
    tablePositions[table.id] = { x: Math.round(spread(tables.length, index, 60, ROOM.width - 60)), y: ROOM.height - 46 };
  });

  return { agents, tools, homes, stations, trays, tables, tablePositions };
}

export const EMPTY_LAYOUT: WorldLayout = { agents: [], tools: [], homes: {}, stations: {}, trays: {}, tables: [], tablePositions: {} };
