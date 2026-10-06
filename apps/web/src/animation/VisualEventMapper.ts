import type { VisiblePlace } from "../protocol/documents";
import { text, type AgentEvent } from "../protocol/events";
import { handOff } from "../protocol/handoff";
import type { VisualAction } from "./visualActions";

// Visualization time (ms at 1x). Unrelated to how long execution actually took.
const SPEECH_HOLD = 1600;
const THOUGHT_HOLD = 1100;
const RESULT_HOLD = 1500;
const READ_HOLD = 700;

/** The sheet an event carries, if it carries one. */
function sheetOf(event: AgentEvent): { documentId: string; title: string; version: number } | undefined {
  const { documentId, title, version } = event.payload;
  if (typeof documentId !== "string" || documentId === "") return undefined;
  return {
    documentId,
    title: typeof title === "string" ? title : "",
    version: typeof version === "number" && Number.isInteger(version) && version > 0 ? version : 1,
  };
}

const hand = (agentId: string): VisiblePlace => ({ kind: "hand", agentId });

/**
 * The single translation layer from the event protocol to visual actions.
 * Pure: the same event always yields the same actions.
 */
export function mapEventToActions(event: AgentEvent): VisualAction[] {
  const actor = event.actorId;
  const sheet = sheetOf(event);
  switch (event.type) {
    case "RUN_STARTED": {
      // The task arrives as a sheet in the in-tray.
      const arrival: VisualAction[] = sheet ? [{ type: "SHOW_DOCUMENT", ...sheet, at: { kind: "tray", tray: "in" } }] : [];
      return [{ type: "RESET" }, ...arrival, { type: "WAIT", ms: 300 }];
    }

    case "AGENT_STARTED": {
      if (!actor) return [];
      const held = Array.isArray(event.payload.documentIds) ? event.payload.documentIds : [];
      return [
        { type: "SET_STATUS", agentId: actor, status: "thinking" },
        // Picks up what it starts from. A sheet already in its hands does not move.
        ...held
          .filter((id): id is string => typeof id === "string")
          .map((documentId): VisualAction => ({ type: "TAKE_DOCUMENT", documentId, to: hand(actor) })),
        { type: "WAIT", ms: 350 },
      ];
    }

    case "MESSAGE_RECEIVED":
      if (!actor) return [];
      return [
        { type: "SET_STATUS", agentId: actor, status: "thinking" },
        { type: "WAIT", ms: 250 },
      ];

    case "DECISION":
      if (!actor) return [];
      return [
        {
          type: "SHOW_BUBBLE",
          agentId: actor,
          text: text(event, "summary"),
          kind: "thought",
          eventId: event.id,
          holdMs: THOUGHT_HOLD,
        },
        { type: "HIDE_BUBBLE", agentId: actor },
      ];

    case "MESSAGE_SENT": {
      if (!actor) return [];
      const target = event.targetId;
      const { line } = handOff(event);
      const actions: VisualAction[] = [];
      // A hand-off is something said, with or without a sheet. With one, the sheet is in the
      // sender's hand (just written, or held all along), carried over and handed to the other.
      if (sheet) actions.push({ type: "SHOW_DOCUMENT", ...sheet, at: hand(actor) });
      if (target) actions.push({ type: "MOVE_TO", agentId: actor, target: { kind: "agent", id: target } });
      // The bubble shows what was said; when nothing was, what the sheet is called.
      if (line) {
        actions.push(
          { type: "TALK", agentId: actor },
          { type: "SHOW_BUBBLE", agentId: actor, text: line, kind: "speech", eventId: event.id, holdMs: SPEECH_HOLD, ...(target ? { listenerId: target } : {}) },
          { type: "HIDE_BUBBLE", agentId: actor },
        );
      }
      if (sheet && target) actions.push({ type: "HAND_DOCUMENT", documentId: sheet.documentId, to: hand(target) });
      actions.push({ type: "SET_STATUS", agentId: actor, status: "waiting" }, { type: "RETURN_TO_POSITION", agentId: actor });
      return actions;
    }

    case "TOOL_CALL": {
      if (!actor) return [];
      // A tool the runtime consulted for the agent animates like one the agent chose: only
      // the thought before it is missing, because there was no decision.
      const tool = text(event, "tool");
      return [
        { type: "MOVE_TO", agentId: actor, target: { kind: "station", id: tool } },
        { type: "WORK", agentId: actor },
        { type: "SHOW_TOOL_ICON", tool, agentId: actor },
        { type: "WAIT", ms: 900 },
      ];
    }

    case "TOOL_RESULT": {
      if (!actor) return [];
      const tool = text(event, "tool");
      return [
        {
          type: "SHOW_BUBBLE",
          agentId: actor,
          text: text(event, "summary") || text(event, "result"),
          kind: "result",
          eventId: event.id,
          holdMs: RESULT_HOLD,
        },
        { type: "HIDE_BUBBLE", agentId: actor },
        { type: "HIDE_TOOL_ICON", tool },
        { type: "SET_STATUS", agentId: actor, status: "thinking" },
        { type: "RETURN_TO_POSITION", agentId: actor },
      ];
    }

    case "DOCUMENT_WRITTEN": {
      const tableId = text(event, "tableId");
      if (!actor || !sheet || !tableId) return [];
      return [
        // Written at the desk, or picked back up for a new version, then carried to the table.
        { type: "SHOW_DOCUMENT", ...sheet, at: hand(actor) },
        { type: "MOVE_TO", agentId: actor, target: { kind: "table", id: tableId } },
        { type: "PLACE_DOCUMENT", documentId: sheet.documentId, to: { kind: "table", tableId } },
        { type: "RETURN_TO_POSITION", agentId: actor },
      ];
    }

    case "DOCUMENT_READ": {
      const tableId = text(event, "tableId");
      if (!actor || !tableId) return [];
      return [
        { type: "MOVE_TO", agentId: actor, target: { kind: "table", id: tableId } },
        { type: "SET_STATUS", agentId: actor, status: "thinking" },
        { type: "WAIT", ms: READ_HOLD },
        { type: "RETURN_TO_POSITION", agentId: actor },
      ];
    }

    case "DOCUMENT_TAKEN": {
      const tableId = text(event, "tableId");
      if (!actor || !sheet || !tableId) return [];
      return [
        { type: "MOVE_TO", agentId: actor, target: { kind: "table", id: tableId } },
        { type: "TAKE_DOCUMENT", documentId: sheet.documentId, to: hand(actor) },
        { type: "RETURN_TO_POSITION", agentId: actor },
      ];
    }

    case "AGENT_FINISHED":
      if (!actor) return [];
      return [
        { type: "FILE_DOCUMENTS", agentId: actor },
        { type: "SET_STATUS", agentId: actor, status: "idle" },
        { type: "WAIT", ms: 150 },
      ];

    case "RUN_FINISHED": {
      if (!sheet) return [{ type: "WAIT", ms: 300 }];
      // The result leaves through the out-tray, put there by whoever wrote it.
      const author = text(event, "authorId");
      const out: VisiblePlace = { kind: "tray", tray: "out" };
      const delivery: VisualAction[] = author
        ? [
            { type: "SHOW_DOCUMENT", ...sheet, at: hand(author) },
            { type: "PLACE_DOCUMENT", documentId: sheet.documentId, to: out },
          ]
        : [{ type: "SHOW_DOCUMENT", ...sheet, at: out }];
      return [...delivery, { type: "WAIT", ms: 300 }];
    }

    case "RUN_ERROR":
      // The alert only points at the problem; the real error lives in the event itself.
      if (!actor) return [{ type: "WAIT", ms: 300 }];
      return [
        { type: "SHOW_ALERT", agentId: actor },
        {
          type: "SHOW_BUBBLE",
          agentId: actor,
          text: text(event, "message"),
          kind: "error",
          eventId: event.id,
          holdMs: SPEECH_HOLD,
        },
      ];
  }
}
