// Wire protocol shared with the server (apps/server/server/events/models.py).

export type AgentEventType =
  | "RUN_STARTED"
  | "AGENT_STARTED"
  | "AGENT_FINISHED"
  | "MESSAGE_SENT"
  | "MESSAGE_RECEIVED"
  | "DECISION"
  | "TOOL_CALL"
  | "TOOL_RESULT"
  | "DOCUMENT_WRITTEN"
  | "DOCUMENT_READ"
  | "DOCUMENT_TAKEN"
  | "RUN_FINISHED"
  | "RUN_ERROR";

export interface AgentEvent {
  id: string;
  runId: string;
  /** Defines replay order. Never order by timestamp. */
  sequence: number;
  timestamp: string;
  type: AgentEventType;
  actorId?: string;
  targetId?: string;
  payload: Record<string, unknown>;
}

export function isTerminal(event: AgentEvent): boolean {
  return event.type === "RUN_FINISHED" || event.type === "RUN_ERROR";
}

/** Reads a string field of an event payload, tolerating absent or non-string values. */
export function text(event: AgentEvent, key: string): string {
  const value = event.payload[key];
  if (typeof value === "string") return value;
  return value === undefined || value === null ? "" : JSON.stringify(value);
}
