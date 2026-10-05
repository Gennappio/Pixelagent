import { text, type AgentEvent } from "../protocol/events";

export interface AgentMessage {
  eventId: string;
  direction: "received" | "sent";
  peerId: string;
  content: string;
}

export interface AgentToolCall {
  eventId: string;
  tool: string;
  arguments: unknown;
  result?: unknown;
  summary?: string;
  latencyMs?: number;
}

export interface AgentRuntimeView {
  status: string;
  model?: string;
  lastReceived?: AgentMessage;
  lastAction?: string;
  durationMs?: number;
  /** Context snapshot saved by the runtime when the agent finished. */
  context?: unknown[];
  contextTokensEstimate: number;
  messages: AgentMessage[];
  toolCalls: AgentToolCall[];
  trace: AgentEvent[];
  error?: string;
}

function metric(event: AgentEvent, key: string): number | undefined {
  const metrics = event.payload.metrics;
  const value = metrics && typeof metrics === "object" ? (metrics as Record<string, unknown>)[key] : undefined;
  return typeof value === "number" ? value : undefined;
}

/**
 * What the debugger knows about one agent, derived only from the events seen so far.
 * Pass the log sliced at the playhead to inspect the agent "as of" that moment.
 */
export function agentRuntimeView(events: readonly AgentEvent[], agentId: string): AgentRuntimeView {
  const view: AgentRuntimeView = {
    status: "Idle",
    contextTokensEstimate: 0,
    messages: [],
    toolCalls: [],
    trace: [],
  };
  let contextChars = 0;

  for (const event of events) {
    const isActor = event.actorId === agentId;
    if (!isActor && event.targetId !== agentId) continue;
    view.trace.push(event);
    if (!isActor) continue;

    switch (event.type) {
      case "MESSAGE_RECEIVED": {
        const message: AgentMessage = {
          eventId: event.id,
          direction: "received",
          peerId: event.targetId ?? "",
          content: text(event, "content"),
        };
        view.messages.push(message);
        view.lastReceived = message;
        view.status = "Received a message";
        break;
      }
      case "AGENT_STARTED": {
        const model = event.payload.model as { provider?: string; name?: string } | undefined;
        if (model) view.model = [model.provider, model.name].filter(Boolean).join(" / ");
        contextChars += text(event, "input").length;
        view.status = "Thinking";
        break;
      }
      case "DECISION":
        view.lastAction = `decision: ${text(event, "summary")}`;
        contextChars += text(event, "summary").length;
        view.status = "Thinking";
        break;
      case "TOOL_CALL":
        view.toolCalls.push({ eventId: event.id, tool: text(event, "tool"), arguments: event.payload.arguments });
        view.lastAction = `${text(event, "tool")}(${JSON.stringify(event.payload.arguments ?? {})})`;
        contextChars += JSON.stringify(event.payload.arguments ?? {}).length;
        view.status = "Waiting for tool";
        break;
      case "TOOL_RESULT": {
        const call = [...view.toolCalls].reverse().find((c) => c.tool === text(event, "tool") && c.result === undefined);
        if (call) {
          call.result = event.payload.result;
          call.summary = text(event, "summary");
          call.latencyMs = metric(event, "latencyMs");
        }
        contextChars += JSON.stringify(event.payload.result ?? "").length;
        view.status = "Thinking";
        break;
      }
      case "MESSAGE_SENT":
        view.messages.push({
          eventId: event.id,
          direction: "sent",
          peerId: event.targetId ?? "",
          content: text(event, "content"),
        });
        view.lastAction = `message to ${event.targetId}`;
        view.status = "Handing off";
        break;
      case "AGENT_FINISHED":
        view.durationMs = metric(event, "durationMs");
        if (Array.isArray(event.payload.context)) view.context = event.payload.context;
        view.status = "Finished";
        break;
      case "RUN_ERROR":
        view.error = text(event, "message");
        view.status = "Error";
        break;
    }
  }

  // Rough heuristic (≈4 characters per token); real usage is runtime-specific and optional.
  view.contextTokensEstimate = Math.ceil(contextChars / 4);
  return view;
}
