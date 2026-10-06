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

// Where things stand is visual metadata saved with the workflow (`layout.positions`) and
// never read by the runtime. These are its keys.
export const agentKey = (agentId: string): string => agentId;
export const tableKey = (tableId: string): string => `table:${tableId}`;
export const stationKey = (tool: string, roomId: string): string => `station:${tool}@${roomId}`;

export type Placed = "agent" | "table" | "station";

/** Where a thing of each kind may stand, by its anchor: on the floor, wholly inside the room. */
export const BOUNDS: Record<Placed, { minX: number; maxX: number; minY: number; maxY: number }> = {
  agent: { minX: 24, maxX: ROOM.width - 24, minY: ROOM.wall + 56, maxY: ROOM.height - 18 },
  table: { minX: 44, maxX: ROOM.width - 44, minY: ROOM.wall + 30, maxY: ROOM.height - 38 },
  // A character stands in front of a station to use it: there has to be floor left for that.
  station: { minX: 40, maxX: ROOM.width - 40, minY: ROOM.wall + 44, maxY: ROOM.height - 90 },
};

/** How close two things of a kind may stand before they are in each other's way. */
const CLEARANCE: Record<Placed, { x: number; y: number }> = {
  agent: { x: 44, y: 34 },
  table: { x: 86, y: 44 },
  station: { x: 84, y: 60 },
};

/** The nearest spot in the room where a thing of that kind may stand, on whole pixels. */
export function clampToRoom(kind: Placed, position: Position): Position {
  const { minX, maxX, minY, maxY } = BOUNDS[kind];
  return {
    x: Math.round(Math.max(minX, Math.min(maxX, position.x))),
    y: Math.round(Math.max(minY, Math.min(maxY, position.y))),
  };
}

function inTheWay(kind: Placed, a: Position, b: Position): boolean {
  return Math.abs(a.x - b.x) < CLEARANCE[kind].x && Math.abs(a.y - b.y) < CLEARANCE[kind].y;
}

/**
 * Where a thing with no place of its own goes when something already stands on its usual
 * spot: the nearest free one along the row, then along the rows in front and behind, one
 * row further each time. The same every time for the same room.
 */
export function freeSpot(kind: Placed, wanted: Position, taken: readonly Position[]): Position {
  const { minX, maxX, minY, maxY } = BOUNDS[kind];
  const pitch = CLEARANCE[kind];
  const columns = Math.floor((maxX - minX) / pitch.x) + 1;
  const rows = Math.floor((maxY - minY) / pitch.y) + 1;
  for (let row = 0; row <= rows; row++) {
    for (const direction of row === 0 ? [1] : [1, -1]) {
      const y = wanted.y + direction * row * pitch.y;
      if (y < minY || y > maxY) continue;
      for (let step = 0; step <= columns; step++) {
        // Alternate sides, a little further out each time.
        for (const side of step === 0 ? [1] : [1, -1]) {
          // Past a wall this is the spot against the wall, which may well be free.
          const candidate = clampToRoom(kind, { x: wanted.x + side * step * pitch.x, y });
          if (!taken.some((other) => inTheWay(kind, candidate, other))) return candidate;
        }
      }
    }
  }
  // The room is full: it stands where it would have, on top of someone.
  return clampToRoom(kind, wanted);
}

function spread(count: number, index: number, from: number, to: number): number {
  return from + ((to - from) * (index + 1)) / (count + 1);
}

/**
 * Places a list of things of one kind: each where the workflow says it stands, the rest in
 * their usual spots, or the nearest free one when something is in the way: a thing that
 * was put there by hand, or, in a crowded office, another of the same kind.
 */
function place(kind: Placed, ids: readonly string[], saved: (id: string) => Position | undefined, usual: (index: number) => Position): Record<string, Position> {
  const placed: Record<string, Position> = {};
  const taken: Position[] = [];
  for (const id of ids) {
    const own = saved(id);
    if (own) taken.push((placed[id] = clampToRoom(kind, own)));
  }
  ids.forEach((id, index) => {
    if (placed[id]) return;
    taken.push((placed[id] = freeSpot(kind, usual(index), taken)));
  });
  // In the order of `ids`, whatever order they were placed in.
  return Object.fromEntries(ids.map((id) => [id, placed[id]]));
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
  const positions = workflow.layout?.positions ?? {};
  const roomId = workflow.rooms?.[0]?.id ?? "office";
  const savedAt = (key: string): Position | undefined => {
    const position = positions[key];
    return position && Number.isFinite(position.x) && Number.isFinite(position.y) ? position : undefined;
  };

  // Many agents stand in two rows, so that neighbours do not overlap. Tables take the front
  // of the room, so with tables the agents stand further back, and two rows closer together.
  const twoRows = agents.length > 4;
  const front = tables.length === 0 ? 280 : twoRows ? 232 : 250;
  const second = front + (tables.length === 0 ? 60 : 50);
  const homes = place(
    "agent",
    agents.map((agent) => agent.id),
    (id) => savedAt(agentKey(id)),
    (index) => ({ x: Math.round(spread(agents.length, index, 20, ROOM.width - 20)), y: twoRows && index % 2 === 1 ? second : front }),
  );

  const stations = place(
    "station",
    tools,
    (tool) => savedAt(stationKey(tool, roomId)),
    (index) => ({ x: Math.round(spread(tools.length, index, 60, ROOM.width - 60)), y: ROOM.wall + 44 }),
  );

  const entry = entryOf(workflow)?.id;
  const exit = exitOf(workflow)?.id;
  const trays: WorldLayout["trays"] = {};
  if (entry && homes[entry]) trays.in = { x: homes[entry].x - TRAY_OFFSET, y: homes[entry].y + 6 };
  if (exit && homes[exit]) trays.out = { x: homes[exit].x + TRAY_OFFSET, y: homes[exit].y + 6 };

  const tablePositions = place(
    "table",
    tables.map((table) => table.id),
    (id) => savedAt(tableKey(id)),
    (index) => ({ x: Math.round(spread(tables.length, index, 60, ROOM.width - 60)), y: ROOM.height - 46 }),
  );

  return { agents, tools, homes, stations, trays, tables, tablePositions };
}

export const EMPTY_LAYOUT: WorldLayout = { agents: [], tools: [], homes: {}, stations: {}, trays: {}, tables: [], tablePositions: {} };
