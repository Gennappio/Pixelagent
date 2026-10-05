import type { AgentEvent } from "../protocol/events";
import type { Run, RunSummary, ToolDescription, Workflow, WorkflowSummary } from "../protocol/workflow";

const BASE = "/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(BASE + path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${init?.method ?? "GET"} ${path} failed (${response.status}): ${body}`);
  }
  return response.json() as Promise<T>;
}

type WorkflowDefinition = Omit<Workflow, "id">;

function definition({ id: _id, ...rest }: Workflow): WorkflowDefinition {
  return rest;
}

export const api = {
  listTools: () => request<ToolDescription[]>("/tools"),
  listWorkflows: () => request<WorkflowSummary[]>("/workflows"),
  getWorkflow: (id: string) => request<Workflow>(`/workflows/${id}`),
  createWorkflow: (workflow: WorkflowDefinition) =>
    request<Workflow>("/workflows", { method: "POST", body: JSON.stringify(workflow) }),
  updateWorkflow: (workflow: Workflow) =>
    request<Workflow>(`/workflows/${workflow.id}`, { method: "PUT", body: JSON.stringify(definition(workflow)) }),
  startRun: (workflowId: string, input: string) =>
    request<Run>(`/workflows/${workflowId}/run`, { method: "POST", body: JSON.stringify({ input }) }),
  listRuns: (workflowId: string) => request<RunSummary[]>(`/runs?workflow_id=${encodeURIComponent(workflowId)}`),
  getRun: (id: string) => request<Run>(`/runs/${id}`),
  getRunEvents: (id: string) => request<AgentEvent[]>(`/runs/${id}/events`),
  exportRun: (id: string) => request<{ run: Run; events: AgentEvent[] }>(`/runs/${id}/export`),
};

/** Streams a run's events (stored ones first, then live). Returns a function that closes the stream. */
export function openRunStream(
  runId: string,
  onEvent: (event: AgentEvent) => void,
  onClose: () => void,
): () => void {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(`${protocol}//${location.host}${BASE}/runs/${runId}/stream`);
  socket.onmessage = (message) => onEvent(JSON.parse(message.data as string) as AgentEvent);
  socket.onclose = onClose;
  return () => {
    socket.onclose = null;
    socket.close();
  };
}
