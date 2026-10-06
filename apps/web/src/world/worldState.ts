import type { AgentStatus, BubbleKind, VisualAction } from "../animation/visualActions";
import { samePlace, type VisiblePlace } from "../protocol/documents";
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

/** A sheet that can be seen: in a tray, in a hand or on a table. Filed sheets are not here. */
export interface DocumentVisualState {
  documentId: string;
  title: string;
  version: number;
  place: VisiblePlace;
  /** While the sheet travels to `place`: where it left from and how far it has got (0..1). */
  transit?: { from: VisiblePlace; progress: number };
}

export interface WorldState {
  agents: Record<string, AgentVisualState>;
  stations: Record<string, StationVisualState>;
  /** In the order the sheets first appeared, which is also how they stack. */
  documents: Record<string, DocumentVisualState>;
}

const WALK_SPEED = 0.17; // world px per ms at 1x
const TALK_DISTANCE = 44;
/** How far in front of a tool station a character stands to use it. */
export const STATION_DISTANCE = 70;
/** How far to the side of a table a character stands to use it. */
export const TABLE_DISTANCE = 52;
/** How long a sheet takes to change hands, at 1x. */
export const SHEET_TRAVEL = 380;
/** How much of each sheet shows above the next one in a pile, so the stack can be counted. */
const PILE_STEP = 5;

export function initialWorldState(layout: WorldLayout): WorldState {
  const state: WorldState = { agents: {}, stations: {}, documents: {} };
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
  if (action.target.kind === "table") {
    const table = layout.tablePositions[action.target.id];
    if (!table) return undefined;
    const side = mover.position.x <= table.x ? -1 : 1;
    return { x: table.x + side * TABLE_DISTANCE, y: table.y };
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
    case "HAND_DOCUMENT":
    case "PLACE_DOCUMENT":
    case "TAKE_DOCUMENT": {
      const sheet = state.documents[action.documentId];
      // Nothing to animate for a sheet that is not there, or is there already.
      return sheet && !samePlace(sheet.place, action.to) ? SHEET_TRAVEL : 0;
    }
    default:
      return 0;
  }
}

/** Which of the sheets lying or held in the same place this one is, counting from the first. */
function slotOf(state: WorldState, sheet: DocumentVisualState): number {
  const together = Object.values(state.documents).filter((other) => samePlace(other.place, sheet.place));
  return Math.max(0, together.findIndex((other) => other.documentId === sheet.documentId));
}

/** Where a sheet in `place` is drawn. Undefined when the layout has no such tray, table or agent. */
function anchor(state: WorldState, layout: WorldLayout, place: VisiblePlace, slot: number): Position | undefined {
  switch (place.kind) {
    case "hand": {
      const holder = state.agents[place.agentId];
      if (!holder) return undefined;
      const side = holder.facing === "right" ? 1 : -1;
      return { x: holder.position.x + side * (15 + slot * 3), y: holder.position.y - 20 - slot * 3 };
    }
    case "tray": {
      const tray = layout.trays[place.tray];
      return tray && { x: tray.x, y: tray.y - 7 - slot * 3 };
    }
    case "table": {
      const table = layout.tablePositions[place.tableId];
      if (!table) return undefined;
      // A pile is a stack, each sheet showing above the one below it; on a shared table
      // the sheets lie side by side.
      const pile = layout.tables.find((candidate) => candidate.id === place.tableId)?.mode === "pile";
      return pile
        ? { x: table.x, y: table.y - 15 - slot * PILE_STEP }
        : { x: table.x - 18 + (slot % 4) * 12, y: table.y - 15 - Math.floor(slot / 4) * 3 };
    }
  }
}

/** Where to draw a sheet right now, following its holder or its journey between two places. */
export function sheetPosition(state: WorldState, layout: WorldLayout, sheet: DocumentVisualState): Position | undefined {
  const to = anchor(state, layout, sheet.place, slotOf(state, sheet));
  if (!sheet.transit) return to;
  const from = anchor(state, layout, sheet.transit.from, 0);
  if (!from || !to) return to ?? from;
  const progress = sheet.transit.progress;
  // A small arc, so a hand-over reads as a toss rather than a slide.
  return {
    x: from.x + (to.x - from.x) * progress,
    y: from.y + (to.y - from.y) * progress - Math.sin(Math.PI * progress) * 12,
  };
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

function withDocument(state: WorldState, sheet: DocumentVisualState): WorldState {
  // Replacing in place keeps the key's position, so stacking order never jumps.
  return { ...state, documents: { ...state.documents, [sheet.documentId]: sheet } };
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
      // On arrival, turn towards who or what the walk was for.
      if (arrived && action.type === "MOVE_TO" && action.target.kind === "agent") {
        const other = state.agents[action.target.id];
        if (other) facing = other.position.x >= to.x ? "right" : "left";
      }
      if (arrived && action.type === "MOVE_TO" && action.target.kind === "table") {
        const table = layout.tablePositions[action.target.id];
        if (table) facing = table.x >= to.x ? "right" : "left";
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
    case "SHOW_DOCUMENT":
      return withDocument(state, {
        documentId: action.documentId,
        title: action.title,
        version: action.version,
        place: action.at,
      });
    case "HAND_DOCUMENT":
    case "PLACE_DOCUMENT":
    case "TAKE_DOCUMENT": {
      const sheet = state.documents[action.documentId];
      if (!sheet || samePlace(sheet.place, action.to)) return state;
      const { transit: _settled, ...still } = sheet;
      return withDocument(
        state,
        progress >= 1
          ? { ...still, place: action.to }
          : { ...still, place: action.to, transit: { from: sheet.place, progress } },
      );
    }
    case "FILE_DOCUMENTS": {
      const kept = Object.entries(state.documents).filter(
        ([, sheet]) => !(sheet.place.kind === "hand" && sheet.place.agentId === action.agentId),
      );
      return kept.length === Object.keys(state.documents).length ? state : { ...state, documents: Object.fromEntries(kept) };
    }
  }
}
