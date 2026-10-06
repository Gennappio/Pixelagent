import type { VisiblePlace } from "../protocol/documents";

// The vocabulary the pixel world understands. Events are translated into these
// by VisualEventMapper; nothing else in the UI maps events to animation.

export type AgentStatus = "idle" | "thinking" | "waiting" | "working";

export type BubbleKind = "speech" | "thought" | "result" | "error";

export type MoveTarget = { kind: "agent"; id: string } | { kind: "station"; id: string } | { kind: "table"; id: string };

export type VisualAction =
  | { type: "RESET" }
  | { type: "WAIT"; ms: number }
  | { type: "MOVE_TO"; agentId: string; target: MoveTarget }
  | { type: "RETURN_TO_POSITION"; agentId: string }
  | { type: "TALK"; agentId: string }
  // `listenerId`: who is being spoken to. They are part of it for as long as the bubble is up.
  | { type: "SHOW_BUBBLE"; agentId: string; text: string; kind: BubbleKind; eventId: string; holdMs: number; listenerId?: string }
  | { type: "HIDE_BUBBLE"; agentId: string }
  | { type: "WORK"; agentId: string }
  | { type: "SHOW_TOOL_ICON"; tool: string; agentId: string }
  | { type: "HIDE_TOOL_ICON"; tool: string }
  | { type: "SET_STATUS"; agentId: string; status: AgentStatus }
  | { type: "SHOW_ALERT"; agentId: string }
  // Sheets. SHOW puts one somewhere at once (a sheet just written, or a new version of it).
  // HAND, PLACE and TAKE make it travel: to another agent, onto a table or tray, into a hand.
  // They are the same motion under three names, so a list of actions reads like what happened.
  | { type: "SHOW_DOCUMENT"; documentId: string; title: string; version: number; at: VisiblePlace }
  | { type: "HAND_DOCUMENT"; documentId: string; to: VisiblePlace }
  | { type: "PLACE_DOCUMENT"; documentId: string; to: VisiblePlace }
  | { type: "TAKE_DOCUMENT"; documentId: string; to: VisiblePlace }
  // The agent is done: the sheets it was holding leave the scene.
  | { type: "FILE_DOCUMENTS"; agentId: string };
