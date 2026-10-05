// The vocabulary the pixel world understands. Events are translated into these
// by VisualEventMapper; nothing else in the UI maps events to animation.

export type AgentStatus = "idle" | "thinking" | "waiting" | "working";

export type BubbleKind = "speech" | "thought" | "result" | "error";

export type MoveTarget = { kind: "agent"; id: string } | { kind: "station"; id: string };

export type VisualAction =
  | { type: "RESET" }
  | { type: "WAIT"; ms: number }
  | { type: "MOVE_TO"; agentId: string; target: MoveTarget }
  | { type: "RETURN_TO_POSITION"; agentId: string }
  | { type: "TALK"; agentId: string }
  | { type: "SHOW_BUBBLE"; agentId: string; text: string; kind: BubbleKind; eventId: string; holdMs: number }
  | { type: "HIDE_BUBBLE"; agentId: string }
  | { type: "WORK"; agentId: string }
  | { type: "SHOW_TOOL_ICON"; tool: string; agentId: string }
  | { type: "HIDE_TOOL_ICON"; tool: string }
  | { type: "SET_STATUS"; agentId: string; status: AgentStatus }
  | { type: "SHOW_ALERT"; agentId: string };
