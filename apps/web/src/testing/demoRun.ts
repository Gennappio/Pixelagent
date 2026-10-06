import demoRun from "../../../../tests/fixtures/demo_run.json";
import tablesRun from "../../../../tests/fixtures/tables_run.json";
import type { DocumentPlace, DocumentRegistry } from "../protocol/documents";
import type { AgentEvent, AgentEventType } from "../protocol/events";
import type { Workflow } from "../protocol/workflow";

// The logs the web tests run on are not written by hand: they are the fixtures the
// server generates and checks (apps/server/tests/test_fixtures.py).

/** The deterministic demo scenario, exactly as the server's runtime emits it. */
export const demoWorkflow = demoRun.run.workflow as unknown as Workflow;
export const demoEvents = demoRun.events as unknown as AgentEvent[];
/** The documents the server folds the demo log to. */
export const demoRegistry = demoRun.registry as unknown as DocumentRegistry;
/** Where the server says each document is after each event (index 0 = after the first). */
export const demoPlaces = demoRun.places as unknown as Record<string, DocumentPlace>[];

/** A run with tables: a pile worked sheet by sheet and a shared, versioned status sheet. */
export const tablesWorkflow = tablesRun.run.workflow as unknown as Workflow;
export const tablesEvents = tablesRun.events as unknown as AgentEvent[];
export const tablesRegistry = tablesRun.registry as unknown as DocumentRegistry;
export const tablesPlaces = tablesRun.places as unknown as Record<string, DocumentPlace>[];

export function eventOfType(type: AgentEventType, actorId?: string, events: AgentEvent[] = demoEvents): AgentEvent {
  const event = events.find((candidate) => candidate.type === type && (actorId === undefined || candidate.actorId === actorId));
  if (!event) throw new Error(`no ${type} event in the run`);
  return event;
}
