import type { Position, Workflow } from "../protocol/workflow";
import { agentKey, buildLayout, clampToRoom, stationKey, tableKey, type Placed } from "../world/layout";

// Moving things about the office. Where something stands is visual metadata saved with the
// workflow and never read by the runtime: dragging changes the layout and nothing else. It
// never connects anything.

/** Something that stands in the room and can be moved: a character, a table, a tool's station. */
export interface Movable {
  kind: Placed;
  /** An agent id, a table id, or for a station the name of its tool. */
  id: string;
}

/** The key of a thing's position in `layout.positions`. Undefined when the office has no such thing. */
export function positionKey(workflow: Workflow, thing: Movable): string | undefined {
  if (thing.kind === "agent") return workflow.agents.some((agent) => agent.id === thing.id) ? agentKey(thing.id) : undefined;
  if (thing.kind === "table") return workflow.tables.some((table) => table.id === thing.id) ? tableKey(thing.id) : undefined;
  const standing = workflow.relations.some((relation) => relation.verb === "uses_tool" && relation.object === thing.id);
  return standing ? stationKey(thing.id, workflow.rooms[0]?.id ?? "office") : undefined;
}

/**
 * Writes down where everything stands now. Things with no place of their own are spread
 * over the room by how many of them there are, so they would shift when one is added or
 * moved by hand: this is what keeps them where the user has been looking at them.
 */
export function pinLayout(workflow: Workflow): Workflow {
  const layout = buildLayout(workflow);
  const roomId = workflow.rooms[0]?.id ?? "office";
  const positions: Record<string, Position> = { ...workflow.layout.positions };
  for (const [id, at] of Object.entries(layout.homes)) positions[agentKey(id)] = at;
  for (const [id, at] of Object.entries(layout.tablePositions)) positions[tableKey(id)] = at;
  for (const [tool, at] of Object.entries(layout.stations)) positions[stationKey(tool, roomId)] = at;
  return samePositions(positions, workflow.layout.positions) ? workflow : { ...workflow, layout: { ...workflow.layout, positions } };
}

function samePositions(a: Record<string, Position>, b: Record<string, Position>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => b[key] && a[key].x === b[key].x && a[key].y === b[key].y);
}

/** Stands a thing somewhere else in the room. Everything else stays exactly where it is. */
export function moveThing(workflow: Workflow, thing: Movable, to: Position): Workflow {
  const key = positionKey(workflow, thing);
  if (!key) return workflow;
  const pinned = pinLayout(workflow);
  const at = clampToRoom(thing.kind, to);
  const was = pinned.layout.positions[key];
  if (was && was.x === at.x && was.y === at.y) return pinned;
  return { ...pinned, layout: { ...pinned.layout, positions: { ...pinned.layout.positions, [key]: at } } };
}
