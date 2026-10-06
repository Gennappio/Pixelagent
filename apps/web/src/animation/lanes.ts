import type { VisiblePlace } from "../protocol/documents";
import type { AgentEvent, AgentEventType } from "../protocol/events";
import type { VisualAction } from "./visualActions";

// Lanes say which events may be animated at the same time. Every entity of the scene is a
// lane; an event uses the lanes its actions touch, and two events can run side by side
// only when they use different ones. Events on the same lane keep their log order.
//
// Lanes decide what may overlap while animating, nothing else: the settled world is
// always the plain fold of the log, whatever the lanes say.

/** Used by an event that concerns the whole office: nothing else runs beside it. */
export const EVERYTHING = "*";

/** The run starting, finishing or failing. */
const RUN_LEVEL = new Set<AgentEventType>(["RUN_STARTED", "RUN_FINISHED", "RUN_ERROR"]);

const agent = (id: string) => `agent:${id}`;

function placeLane(place: VisiblePlace): string {
  switch (place.kind) {
    case "hand":
      return agent(place.agentId);
    case "table":
      return `table:${place.tableId}`;
    case "tray":
      return `tray:${place.tray}`;
  }
}

/** The entities one action touches. None for an action that only lets time pass. */
export function lanesOfAction(action: VisualAction): string[] {
  switch (action.type) {
    case "RESET":
      return [EVERYTHING];
    case "WAIT":
      return [];
    case "MOVE_TO":
      // The walker, and who or what it walks up to: its position is read to get there.
      return [agent(action.agentId), action.target.kind === "agent" ? agent(action.target.id) : `${action.target.kind}:${action.target.id}`];
    case "RETURN_TO_POSITION":
    case "TALK":
    case "SHOW_BUBBLE":
    case "HIDE_BUBBLE":
    case "WORK":
    case "SET_STATUS":
    case "SHOW_ALERT":
    case "FILE_DOCUMENTS":
      return [agent(action.agentId)];
    case "SHOW_TOOL_ICON":
      return [`station:${action.tool}`, agent(action.agentId)];
    case "HIDE_TOOL_ICON":
      return [`station:${action.tool}`];
    case "SHOW_DOCUMENT":
      return [`document:${action.documentId}`, placeLane(action.at)];
    case "HAND_DOCUMENT":
    case "PLACE_DOCUMENT":
    case "TAKE_DOCUMENT":
      return [`document:${action.documentId}`, placeLane(action.to)];
  }
}

/**
 * For every lane an event uses, the index of the last of its actions that needs it.
 *
 * A lane is given back as soon as that action is over, not when the whole event is:
 * once Anna has handed Luca the sheet, Luca is free to react while she walks back.
 */
export function laneSpans(event: AgentEvent, actions: readonly VisualAction[]): Map<string, number> {
  const spans = new Map<string, number>();
  actions.forEach((action, index) => {
    const lanes = lanesOfAction(action);
    // A pause is shared: everyone the event has involved so far waits through it.
    for (const lane of lanes.length > 0 ? lanes : [...spans.keys()]) spans.set(lane, index);
  });
  if (RUN_LEVEL.has(event.type) && actions.length > 0) spans.set(EVERYTHING, actions.length - 1);
  return spans;
}

/** The lanes an event is still using when it is at action `index` (0 = not started). */
export function lanesHeld(spans: ReadonlyMap<string, number>, index: number): string[] {
  return [...spans].filter(([, last]) => last >= index).map(([lane]) => lane);
}

/** Whether an event that wants `wanted` must wait for one that still holds `held`. */
export function lanesConflict(held: readonly string[], wanted: ReadonlyMap<string, number>): boolean {
  // An event with nothing to show is in nobody's way, and nobody is in its way.
  if (held.length === 0 || wanted.size === 0) return false;
  if (wanted.has(EVERYTHING) || held.includes(EVERYTHING)) return true;
  return held.some((lane) => wanted.has(lane));
}
