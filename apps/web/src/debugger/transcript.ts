import { text, type AgentEvent } from "../protocol/events";
import { handOff } from "../protocol/handoff";
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
 *
 * `names` maps agent ids, and table ids, to what they are called.
 */
export function describeEvent(event: AgentEvent, names: Record<string, string>): string {
  const name = (id?: string) => (id ? (names[id] ?? id) : "Someone");
  const actor = name(event.actorId);
  const sheet = typeof event.payload.documentId === "string" && event.payload.documentId !== "";
  const table = () => `the table ${quote(name(text(event, "tableId")))}`;
  switch (event.type) {
    case "RUN_STARTED":
      return `Run started with the task ${quote(text(event, "input"))}.`;
    case "AGENT_STARTED":
      return `${actor} started working.`;
    case "MESSAGE_SENT": {
      // What was said, then what was handed over; either half may be missing.
      const { message, sheet: handed, line } = handOff(event);
      const target = name(event.targetId);
      if (!handed) return message ? `${actor} to ${target}: ${quote(message)}` : `${actor} had nothing to say or hand to ${target}.`;
      // A sheet from before hand-offs had words is named by what it says: its title was a formality.
      const label = quote(message === undefined ? line : handed.title || line);
      return message ? `${actor} to ${target}: ${quote(message)} and handed over ${label}.` : `${actor} handed ${label} to ${target}.`;
    }
    case "MESSAGE_RECEIVED":
      return `${actor} received the ${sheet ? "sheet" : "message"} from ${name(event.targetId)}.`;
    case "DOCUMENT_WRITTEN": {
      const version = Number(event.payload.version);
      const which = version > 1 ? `version ${version} of ${quote(text(event, "title"))}` : quote(text(event, "title"));
      return `${actor} put ${which} on ${table()}.`;
    }
    case "DOCUMENT_READ": {
      const count = Array.isArray(event.payload.documentIds) ? event.payload.documentIds.length : 0;
      return `${actor} read ${count === 1 ? "the sheet" : `${count} sheets`} on ${table()}.`;
    }
    case "DOCUMENT_TAKEN": {
      const remaining = event.payload.remaining;
      const left = typeof remaining === "number" ? `, ${remaining} left` : "";
      return `${actor} took a sheet from ${table()}${left}.`;
    }
    case "DECISION":
      return `${actor} decided: ${text(event, "summary")}`;
    case "TOOL_CALL":
      // Consulted: the workflow says the tool comes first, and nobody decided to call it.
      return `${actor} ${event.payload.required === true ? "consulted" : "called"} ${toolLabel(text(event, "tool"))} (${formatArguments(event.payload.arguments)}).`;
    case "TOOL_RESULT":
      return `${toolLabel(text(event, "tool"))} returned to ${actor}: ${text(event, "summary") || text(event, "result")}`;
    case "AGENT_FINISHED":
      return `${actor} finished.`;
    case "RUN_FINISHED":
      return sheet ? "Run finished. The result is in the out-tray." : "Run finished.";
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
