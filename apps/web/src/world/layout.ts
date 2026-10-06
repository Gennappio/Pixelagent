import { entryOf, exitOf, toolsInUse } from "../protocol/relations";
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
  /** One station per tool some agent can use. Stations are not placed by hand. */
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

export function buildLayout(workflow: Workflow): WorldLayout {
  const agents = workflow.agents.map(({ id, name, role, appearance }) => ({
    id,
    name,
    role,
    sprite: appearance.sprite,
  }));
  const tools = toolsInUse(workflow);
  const tables = workflow.tables.map(({ id, name, mode }) => ({ id, name: name || id, mode }));

  // Many agents stand in two rows, so that neighbours do not overlap. Tables take the front
  // of the room, so with tables the agents stand further back, and two rows closer together.
  const twoRows = agents.length > 4;
  const front = tables.length === 0 ? 280 : twoRows ? 232 : 250;
  const second = front + (tables.length === 0 ? 60 : 50);
  const homes: Record<string, Position> = {};
  agents.forEach((agent, index) => {
    homes[agent.id] = {
      x: Math.round(spread(agents.length, index, 20, ROOM.width - 20)),
      y: twoRows && index % 2 === 1 ? second : front,
    };
  });

  const stations: Record<string, Position> = {};
  tools.forEach((tool, index) => {
    stations[tool] = { x: Math.round(spread(tools.length, index, 60, ROOM.width - 60)), y: ROOM.wall + 44 };
  });

  const entry = entryOf(workflow)?.id;
  const exit = exitOf(workflow)?.id;
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
