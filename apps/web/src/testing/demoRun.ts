import type { AgentEvent, AgentEventType } from "../protocol/events";
import type { Workflow } from "../protocol/workflow";

// The deterministic demo scenario, as the server's SimpleRuntime emits it.

export const demoWorkflow: Workflow = {
  id: "demo",
  name: "Sales report demo",
  input: "Find the latest sales number and send it to management.",
  agents: [
    {
      id: "anna",
      name: "Anna",
      role: "Manager",
      systemPrompt: "Coordinate the task and delegate work.",
      model: { provider: "fake", name: "scripted-v1" },
      tools: [],
      appearance: { sprite: "agent_female_01" },
    },
    {
      id: "luca",
      name: "Luca",
      role: "Researcher",
      systemPrompt: "Research the request.",
      model: { provider: "fake", name: "scripted-v1" },
      tools: [{ name: "web_search" }],
      appearance: { sprite: "agent_male_01" },
    },
    {
      id: "gianni",
      name: "Gianni",
      role: "Communication",
      systemPrompt: "Deliver results.",
      model: { provider: "fake", name: "scripted-v1" },
      tools: [{ name: "send_email" }],
      appearance: { sprite: "agent_male_02" },
    },
  ],
  nodes: [
    { id: "start", type: "start", position: { x: 0, y: 0 } },
    { id: "node_anna", type: "agent", agentId: "anna", position: { x: 0, y: 100 } },
    { id: "node_luca", type: "agent", agentId: "luca", position: { x: 0, y: 200 } },
    { id: "node_search", type: "tool", tool: "web_search", position: { x: 200, y: 200 } },
    { id: "node_gianni", type: "agent", agentId: "gianni", position: { x: 0, y: 300 } },
    { id: "node_email", type: "tool", tool: "send_email", position: { x: 200, y: 300 } },
    { id: "end", type: "end", position: { x: 0, y: 400 } },
  ],
  edges: [
    { id: "e1", source: "start", target: "node_anna" },
    { id: "e2", source: "node_anna", target: "node_luca" },
    { id: "e3", source: "node_luca", target: "node_search" },
    { id: "e4", source: "node_luca", target: "node_gianni" },
    { id: "e5", source: "node_gianni", target: "node_email" },
    { id: "e6", source: "node_gianni", target: "end" },
  ],
};

type Draft = [AgentEventType, string | undefined, string | undefined, Record<string, unknown>];

const drafts: Draft[] = [
  ["RUN_STARTED", undefined, undefined, { input: demoWorkflow.input }],
  ["AGENT_STARTED", "anna", undefined, { input: demoWorkflow.input, model: { provider: "fake", name: "scripted-v1" } }],
  ["DECISION", "anna", undefined, { kind: "handoff", summary: "Hand off to Luca.", target: "luca" }],
  ["MESSAGE_SENT", "anna", "luca", { content: "Find the latest sales number." }],
  ["AGENT_FINISHED", "anna", undefined, { output: "Find the latest sales number.", metrics: { durationMs: 12 } }],
  ["MESSAGE_RECEIVED", "luca", "anna", { content: "Find the latest sales number." }],
  ["AGENT_STARTED", "luca", undefined, { input: "Find the latest sales number." }],
  ["DECISION", "luca", undefined, { kind: "tool_selection", summary: "Use web_search to handle the request." }],
  ["TOOL_CALL", "luca", undefined, { tool: "web_search", arguments: { query: "Find the latest sales number." } }],
  [
    "TOOL_RESULT",
    "luca",
    undefined,
    { tool: "web_search", result: { summary: "Sales: €1.2M" }, summary: "Sales: €1.2M", metrics: { latencyMs: 230 } },
  ],
  ["DECISION", "luca", undefined, { kind: "handoff", summary: "Hand off to Gianni.", target: "gianni" }],
  ["MESSAGE_SENT", "luca", "gianni", { content: "Send this result to management: Sales: €1.2M" }],
  ["AGENT_FINISHED", "luca", undefined, { output: "Send this result to management: Sales: €1.2M", context: [{ kind: "system" }] }],
  ["MESSAGE_RECEIVED", "gianni", "luca", { content: "Send this result to management: Sales: €1.2M" }],
  ["AGENT_STARTED", "gianni", undefined, { input: "Send this result to management: Sales: €1.2M" }],
  ["DECISION", "gianni", undefined, { kind: "tool_selection", summary: "Use send_email to handle the request." }],
  ["TOOL_CALL", "gianni", undefined, { tool: "send_email", arguments: { to: "management@example.com" } }],
  ["TOOL_RESULT", "gianni", undefined, { tool: "send_email", summary: "Email sent to management@example.com" }],
  ["AGENT_FINISHED", "gianni", undefined, { output: "Email sent to management@example.com" }],
  ["RUN_FINISHED", undefined, undefined, { output: "Email sent to management@example.com" }],
];

export const demoEvents: AgentEvent[] = drafts.map(([type, actorId, targetId, payload], index) => ({
  id: `evt_${String(index + 1).padStart(4, "0")}`,
  runId: "run_demo",
  sequence: index + 1,
  // Deliberately identical timestamps: ordering must come from `sequence`.
  timestamp: "2026-10-05T14:31:02.000Z",
  type,
  actorId,
  targetId,
  payload,
}));

export function eventOfType(type: AgentEventType, actorId?: string): AgentEvent {
  const event = demoEvents.find((e) => e.type === type && (actorId === undefined || e.actorId === actorId));
  if (!event) throw new Error(`no ${type} event in the demo run`);
  return event;
}
