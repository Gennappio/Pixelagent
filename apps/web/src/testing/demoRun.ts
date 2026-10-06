import demoRun from "../../../../tests/fixtures/demo_run.json";
import parallelRun from "../../../../tests/fixtures/parallel_run.json";
import tablesRun from "../../../../tests/fixtures/tables_run.json";
import workflowsV1 from "../../../../tests/fixtures/workflow_v1.json";
import type { DocumentPlace, DocumentRegistry } from "../protocol/documents";
import type { AgentEvent, AgentEventType } from "../protocol/events";
import type { Workflow } from "../protocol/workflow";

// The logs the web tests run on are not written by hand: they are real runs of the
// workflows in <repo>/workflows, generated and checked by the server
// (apps/server/tests/test_fixtures.py).

/** Workflows of revision 1, each next to what the server upgrades it to. */
export const v1Cases = workflowsV1.cases as unknown as { name: string; v1: Record<string, unknown>; v2: Record<string, unknown> }[];

/** The deterministic demo scenario, exactly as the server's runtime emits it. */
export const demoWorkflow = demoRun.run.workflow as unknown as Workflow;
export const demoEvents = demoRun.events as unknown as AgentEvent[];
/** The documents the server folds the demo log to. */
export const demoRegistry = demoRun.registry as unknown as DocumentRegistry;
/** Where the server says each document is after each event (index 0 = after the first). */
export const demoPlaces = demoRun.places as unknown as Record<string, DocumentPlace>[];

/** "Supplier board": a pile worked sheet by sheet, a shared board, a splitter and a collector. */
export const tablesWorkflow = tablesRun.run.workflow as unknown as Workflow;
export const tablesEvents = tablesRun.events as unknown as AgentEvent[];
export const tablesRegistry = tablesRun.registry as unknown as DocumentRegistry;
export const tablesPlaces = tablesRun.places as unknown as Record<string, DocumentPlace>[];

/** "Two desks": Luca and Gianni at work at the same time, and Marta who waits for both. */
export const parallelWorkflow = parallelRun.run.workflow as unknown as Workflow;
export const parallelEvents = parallelRun.events as unknown as AgentEvent[];
export const parallelRegistry = parallelRun.registry as unknown as DocumentRegistry;
export const parallelPlaces = parallelRun.places as unknown as Record<string, DocumentPlace>[];

export function eventOfType(type: AgentEventType, actorId?: string, events: AgentEvent[] = demoEvents): AgentEvent {
  const event = events.find((candidate) => candidate.type === type && (actorId === undefined || candidate.actorId === actorId));
  if (!event) throw new Error(`no ${type} event in the run`);
  return event;
}
