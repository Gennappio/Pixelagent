import { text, type AgentEvent } from "../protocol/events";
import type { VisualAction } from "./visualActions";

// Visualization time (ms at 1x). Unrelated to how long execution actually took.
const SPEECH_HOLD = 1600;
const THOUGHT_HOLD = 1100;
const RESULT_HOLD = 1500;

/**
 * The single translation layer from the event protocol to visual actions.
 * Pure: the same event always yields the same actions.
 */
export function mapEventToActions(event: AgentEvent): VisualAction[] {
  const actor = event.actorId;
  switch (event.type) {
    case "RUN_STARTED":
      return [{ type: "RESET" }, { type: "WAIT", ms: 300 }];

    case "AGENT_STARTED":
      if (!actor) return [];
      return [
        { type: "SET_STATUS", agentId: actor, status: "thinking" },
        { type: "WAIT", ms: 350 },
      ];

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
      const actions: VisualAction[] = [];
      if (event.targetId) actions.push({ type: "MOVE_TO", agentId: actor, target: { kind: "agent", id: event.targetId } });
      actions.push(
        { type: "TALK", agentId: actor },
        {
          type: "SHOW_BUBBLE",
          agentId: actor,
          text: text(event, "content"),
          kind: "speech",
          eventId: event.id,
          holdMs: SPEECH_HOLD,
        },
        { type: "HIDE_BUBBLE", agentId: actor },
        { type: "SET_STATUS", agentId: actor, status: "waiting" },
        { type: "RETURN_TO_POSITION", agentId: actor },
      );
      return actions;
    }

    case "TOOL_CALL": {
      if (!actor) return [];
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

    case "AGENT_FINISHED":
      if (!actor) return [];
      return [
        { type: "SET_STATUS", agentId: actor, status: "idle" },
        { type: "WAIT", ms: 150 },
      ];

    case "RUN_FINISHED":
      return [{ type: "WAIT", ms: 300 }];

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
