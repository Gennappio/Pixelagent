import type { Position, Workflow } from "../protocol/workflow";

export const ROOM = { width: 640, height: 400, wall: 56 };

export interface LayoutAgent {
  id: string;
  name: string;
  role: string;
  sprite: string;
}

/** Where things stand in the room. Derived from the workflow alone, so it is reproducible. */
export interface WorldLayout {
  agents: LayoutAgent[];
  tools: string[];
  homes: Record<string, Position>;
  stations: Record<string, Position>;
}

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
  const tools = [
    ...new Set([
      ...workflow.nodes.flatMap((node) => (node.type === "tool" && node.tool ? [node.tool] : [])),
      ...workflow.agents.flatMap((agent) => agent.tools.map((tool) => tool.name)),
    ]),
  ];

  const homes: Record<string, Position> = {};
  agents.forEach((agent, index) => {
    homes[agent.id] = {
      x: Math.round(spread(agents.length, index, 20, ROOM.width - 20)),
      // Alternate rows so neighbours do not overlap when there are many agents.
      y: agents.length > 4 && index % 2 === 1 ? 340 : 280,
    };
  });

  const stations: Record<string, Position> = {};
  tools.forEach((tool, index) => {
    stations[tool] = { x: Math.round(spread(tools.length, index, 60, ROOM.width - 60)), y: ROOM.wall + 44 };
  });

  return { agents, tools, homes, stations };
}

export const EMPTY_LAYOUT: WorldLayout = { agents: [], tools: [], homes: {}, stations: {} };
