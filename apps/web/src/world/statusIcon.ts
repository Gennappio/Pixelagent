import type { IconName } from "../pixel/bitmaps";
import type { AgentVisualState } from "./worldState";

/**
 * The icon over a character's head: an error before anything else, else what it is doing.
 * None while it stands idle, and none under a speech bubble, which takes the same spot.
 */
export function statusIcon(state: Pick<AgentVisualState, "status" | "alert" | "speechBubble">): IconName | null {
  if (state.speechBubble) return null;
  if (state.alert) return "error";
  return state.status === "idle" ? null : state.status;
}
