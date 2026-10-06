import demoRun from "../../../../tests/fixtures/demo_run.json";
import parallelRun from "../../../../tests/fixtures/parallel_run.json";
import oldDemoRun from "../../../../tests/fixtures/revision2/demo_run.json";
import oldParallelRun from "../../../../tests/fixtures/revision2/parallel_run.json";
import oldTablesRun from "../../../../tests/fixtures/revision2/tables_run.json";
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

export interface StoredRun {
  name: string;
  workflow: Workflow;
  events: AgentEvent[];
  /** The documents the server folds the log to. */
  registry: DocumentRegistry;
  /** Where the server says each document is after each event. */
  places: Record<string, DocumentPlace>[];
}

function stored(name: string, run: { run: { workflow: unknown }; events: unknown; registry: unknown; places: unknown }): StoredRun {
  return {
    name,
    workflow: run.run.workflow as Workflow,
    events: run.events as AgentEvent[],
    registry: run.registry as DocumentRegistry,
    places: run.places as Record<string, DocumentPlace>[],
  };
}

/** The three runs as the runtime writes them now. */
export const currentRuns: StoredRun[] = [stored("demo", demoRun), stored("tables", tablesRun), stored("two desks", parallelRun)];

/**
 * The same three runs as the runtime wrote them before revision 3, when a hand-off was a
 * sheet and nothing else: kept as they were, with the registry the server folded them to
 * then. Logs like these are in people's databases and exports and must go on replaying.
 */
export const oldRuns: StoredRun[] = [stored("demo, revision 2", oldDemoRun), stored("tables, revision 2", oldTablesRun), stored("two desks, revision 2", oldParallelRun)];
export const oldDemoEvents = oldRuns[0].events;

export const everyRun: StoredRun[] = [...currentRuns, ...oldRuns];

/**
 * Where in a log the nth event of that type by that actor is, counting from 0. Tests name
 * events this way rather than by number, so that a log gaining or losing an event elsewhere
 * does not move them.
 */
export function indexOfEvent(events: readonly AgentEvent[], type: AgentEventType, actorId?: string, nth = 0): number {
  const found = events.flatMap((event, index) => (event.type === type && (actorId === undefined || event.actorId === actorId) ? [index] : []));
  if (found[nth] === undefined) throw new Error(`no ${type} event number ${nth + 1}${actorId ? ` by ${actorId}` : ""} in the run`);
  return found[nth];
}

/** The sequence of that event: folding the log up to it includes it. */
export function sequenceOf(events: readonly AgentEvent[], type: AgentEventType, actorId?: string, nth = 0): number {
  return events[indexOfEvent(events, type, actorId, nth)].sequence;
}

export function eventOfType(type: AgentEventType, actorId?: string, events: AgentEvent[] = demoEvents): AgentEvent {
  const event = events.find((candidate) => candidate.type === type && (actorId === undefined || candidate.actorId === actorId));
  if (!event) throw new Error(`no ${type} event in the run`);
  return event;
}
