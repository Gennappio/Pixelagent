import type { AgentStatus, BubbleKind, VisualAction } from "../animation/visualActions";
import type { Position } from "../protocol/workflow";
import type { WorldLayout } from "./layout";

export type AgentAnimation = "idle" | "walk" | "talk" | "working";

export interface SpeechBubbleState {
  text: string;
  kind: BubbleKind;
  /** The event behind the bubble: clicking it opens that event. */
  eventId: string;
}

/** Purely visual. Never read by, or fed back into, the runtime. */
export interface AgentVisualState {
  agentId: string;
  position: Position;
  facing: "left" | "right";
  animation: AgentAnimation;
  currentTarget?: string;
  speechBubble?: SpeechBubbleState;
  status: AgentStatus;
  alert: boolean;
}

export interface StationVisualState {
  tool: string;
  active: boolean;
  userId?: string;
}

export interface WorldState {
  agents: Record<string, AgentVisualState>;
  stations: Record<string, StationVisualState>;
}

const WALK_SPEED = 0.17; // world px per ms at 1x
const TALK_DISTANCE = 44;
/** How far in front of a tool station a character stands to use it. */
export const STATION_DISTANCE = 70;

export function initialWorldState(layout: WorldLayout): WorldState {
  const state: WorldState = { agents: {}, stations: {} };
  for (const agent of layout.agents) {
    state.agents[agent.id] = {
      agentId: agent.id,
      position: layout.homes[agent.id],
      facing: "right",
      animation: "idle",
      status: "idle",
      alert: false,
    };
  }
  for (const tool of layout.tools) state.stations[tool] = { tool, active: false };
  return state;
}

function destination(state: WorldState, action: VisualAction, layout: WorldLayout): Position | undefined {
  if (action.type === "RETURN_TO_POSITION") return layout.homes[action.agentId];
  if (action.type !== "MOVE_TO") return undefined;
  const mover = state.agents[action.agentId];
  if (!mover) return undefined;
  if (action.target.kind === "station") {
    const station = layout.stations[action.target.id];
    return station && { x: station.x, y: station.y + STATION_DISTANCE };
  }
  const other = state.agents[action.target.id];
  if (!other) return undefined;
  const side = mover.position.x <= other.position.x ? -1 : 1;
  return { x: other.position.x + side * TALK_DISTANCE, y: other.position.y };
}

/** How long an action takes on screen at 1x. Visualization time, not execution time. */
export function actionDuration(state: WorldState, action: VisualAction, layout: WorldLayout): number {
  switch (action.type) {
    case "WAIT":
      return action.ms;
    case "SHOW_BUBBLE":
      return action.holdMs;
    case "TALK":
      return 200;
    case "MOVE_TO":
    case "RETURN_TO_POSITION": {
      const from = state.agents[action.agentId]?.position;
      const to = destination(state, action, layout);
      return from && to ? Math.hypot(to.x - from.x, to.y - from.y) / WALK_SPEED : 0;
    }
    default:
      return 0;
  }
}

function withAgent(state: WorldState, agentId: string, patch: Partial<AgentVisualState>): WorldState {
  const agent = state.agents[agentId];
  if (!agent) return state; // events may mention agents the layout does not know
  return { ...state, agents: { ...state.agents, [agentId]: { ...agent, ...patch } } };
}

function withStation(state: WorldState, tool: string, patch: Partial<StationVisualState>): WorldState {
  const station = state.stations[tool];
  if (!station) return state;
  return { ...state, stations: { ...state.stations, [tool]: { ...station, ...patch } } };
}

/**
 * The world after `action` has run for `progress` (0..1) starting from `state`.
 * Pure, so any moment of any run can be recomputed from the event log alone.
 */
export function applyAction(state: WorldState, action: VisualAction, progress: number, layout: WorldLayout): WorldState {
  switch (action.type) {
    case "RESET":
      return initialWorldState(layout);
    case "WAIT":
      return state;
    case "MOVE_TO":
    case "RETURN_TO_POSITION": {
      const agent = state.agents[action.agentId];
      const to = destination(state, action, layout);
      if (!agent || !to) return state;
      const from = agent.position;
      const arrived = progress >= 1;
      const returning = action.type === "RETURN_TO_POSITION";
      let facing = to.x === from.x ? agent.facing : to.x > from.x ? "right" : "left";
      if (arrived && action.type === "MOVE_TO" && action.target.kind === "agent") {
        const other = state.agents[action.target.id];
        if (other) facing = other.position.x >= to.x ? "right" : "left";
      }
      return withAgent(state, action.agentId, {
        position: arrived ? to : { x: from.x + (to.x - from.x) * progress, y: from.y + (to.y - from.y) * progress },
        facing,
        animation: arrived ? "idle" : "walk",
        currentTarget: returning ? undefined : action.target.id,
      });
    }
    case "TALK":
      return withAgent(state, action.agentId, { animation: "talk" });
    case "SHOW_BUBBLE":
      return withAgent(state, action.agentId, {
        speechBubble: { text: action.text, kind: action.kind, eventId: action.eventId },
      });
    case "HIDE_BUBBLE": {
      const agent = state.agents[action.agentId];
      return withAgent(state, action.agentId, {
        speechBubble: undefined,
        animation: agent?.animation === "talk" ? "idle" : agent?.animation,
      });
    }
    case "WORK":
      return withAgent(state, action.agentId, { animation: "working", status: "working" });
    case "SHOW_TOOL_ICON":
      return withStation(state, action.tool, { active: true, userId: action.agentId });
    case "HIDE_TOOL_ICON":
      return withStation(state, action.tool, { active: false, userId: undefined });
    case "SET_STATUS":
      return withAgent(state, action.agentId, { status: action.status });
    case "SHOW_ALERT":
      return withAgent(state, action.agentId, { alert: true });
  }
}
