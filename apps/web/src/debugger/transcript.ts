import { text, type AgentEvent } from "../protocol/events";
import { toolLabel } from "../protocol/workflow";

export interface TranscriptLine {
  eventId: string;
  sequence: number;
  time: string;
  text: string;
  isError: boolean;
}

function quote(value: string): string {
  return `“${value}”`;
}

function formatArguments(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  return Object.entries(value)
    .map(([key, argument]) => `${key}: ${typeof argument === "string" ? quote(argument) : JSON.stringify(argument)}`)
    .join(", ");
}

/**
 * One readable sentence per event, from fixed templates. No LLM involved, so the
 * transcript is as deterministic as the event log it describes.
 */
export function describeEvent(event: AgentEvent, names: Record<string, string>): string {
  const name = (id?: string) => (id ? (names[id] ?? id) : "Someone");
  const actor = name(event.actorId);
  switch (event.type) {
    case "RUN_STARTED":
      return `Run started with the task ${quote(text(event, "input"))}.`;
    case "AGENT_STARTED":
      return `${actor} started working.`;
    case "MESSAGE_SENT":
      return `${actor} told ${name(event.targetId)}: ${quote(text(event, "content"))}`;
    case "MESSAGE_RECEIVED":
      return `${actor} received the message from ${name(event.targetId)}.`;
    case "DECISION":
      return `${actor} decided: ${text(event, "summary")}`;
    case "TOOL_CALL":
      return `${actor} called ${toolLabel(text(event, "tool"))} (${formatArguments(event.payload.arguments)}).`;
    case "TOOL_RESULT":
      return `${toolLabel(text(event, "tool"))} returned to ${actor}: ${text(event, "summary") || text(event, "result")}`;
    case "AGENT_FINISHED":
      return `${actor} finished.`;
    case "RUN_FINISHED":
      return "Run finished.";
    case "RUN_ERROR":
      return `Error${event.actorId ? ` (${actor})` : ""}: ${text(event, "message")}`;
  }
}

export function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? timestamp : date.toISOString().slice(11, 19);
}

export function buildTranscript(events: readonly AgentEvent[], names: Record<string, string>): TranscriptLine[] {
  return events.map((event) => ({
    eventId: event.id,
    sequence: event.sequence,
    time: formatTime(event.timestamp),
    text: describeEvent(event, names),
    isError: event.type === "RUN_ERROR",
  }));
}
