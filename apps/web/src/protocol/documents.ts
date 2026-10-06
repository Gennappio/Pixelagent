import type { AgentEvent } from "./events";

// Documents ("fogli"): the unit of content with an identity. They are never stored on
// their own: every version travels inside the event that created it, and this module
// reads them back out of the log.
//
// The server folds the same events with the same rules
// (apps/server/server/documents/registry.py). tests/fixtures holds logs both must read
// identically. Change one side and the other has to follow.

/** The run input is always this document. */
export const INPUT_DOCUMENT_ID = "doc_input";

export interface DocumentVersion {
  version: number;
  title: string;
  /** A string, or any JSON value a tool or an agent produced. */
  content?: unknown;
  /** Absent for the run input, which the user wrote. */
  authorId?: string;
  /** Sequence of the event that created this version. */
  createdSequence?: number;
}

/**
 * Where a sheet is. tray: the run's in-tray or out-tray. hand: an agent is holding it.
 * table: lying on a table. filed: put away by the agent who was done with it.
 */
export type DocumentPlace =
  | { kind: "tray"; tray: "in" | "out" }
  | { kind: "hand"; agentId: string }
  | { kind: "table"; tableId: string }
  | { kind: "filed"; agentId: string };

/** The places where a sheet can be seen in the world. A filed sheet is out of sight. */
export type VisiblePlace = Exclude<DocumentPlace, { kind: "filed" }>;

export type DocumentAction =
  | "created"
  | "picked_up"
  | "handed"
  | "received"
  | "filed"
  | "written"
  | "read"
  | "taken"
  | "delivered";

/** One thing that happened to a document, in log order. */
export interface DocumentTouch {
  sequence?: number;
  action: DocumentAction;
  agentId?: string;
  /** The other agent of a hand-over. */
  peerId?: string;
  tableId?: string;
  version?: number;
}

export interface DocumentRecord {
  id: string;
  versions: DocumentVersion[];
  place: DocumentPlace;
  history: DocumentTouch[];
}

export interface DocumentRegistry {
  documents: Record<string, DocumentRecord>;
  /** Document ids in creation order. */
  order: string[];
  /** Table id → the documents lying on it, oldest first. */
  tables: Record<string, string[]>;
}

export const inTray = (): DocumentPlace => ({ kind: "tray", tray: "in" });
export const outTray = (): DocumentPlace => ({ kind: "tray", tray: "out" });
export const inHand = (agentId: string): DocumentPlace => ({ kind: "hand", agentId });
export const onTable = (tableId: string): DocumentPlace => ({ kind: "table", tableId });
export const filedBy = (agentId: string): DocumentPlace => ({ kind: "filed", agentId });

export function samePlace(a: DocumentPlace, b: DocumentPlace): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case "tray":
      return a.tray === (b as typeof a).tray;
    case "table":
      return a.tableId === (b as typeof a).tableId;
    default:
      return a.agentId === (b as typeof a).agentId;
  }
}

export function latestVersion(record: DocumentRecord): DocumentVersion {
  return record.versions[record.versions.length - 1];
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function ids(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
}

/** A version is a positive whole number; anything else counts as 1. */
function versionOf(payload: Record<string, unknown>): number {
  const version = payload.version;
  return typeof version === "number" && Number.isInteger(version) && version > 0 ? version : 1;
}

/** Drops absent fields, so a record looks the same whichever side produced it. */
function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined && field !== null)) as T;
}

function enter(registry: DocumentRegistry, record: DocumentRecord): void {
  if (record.place.kind === "table") (registry.tables[record.place.tableId] ??= []).push(record.id);
}

function move(registry: DocumentRegistry, record: DocumentRecord, place: DocumentPlace): void {
  if (samePlace(record.place, place)) return; // a new version of a sheet on a table keeps its spot
  if (record.place.kind === "table") {
    const table = registry.tables[record.place.tableId];
    table.splice(table.indexOf(record.id), 1);
  }
  record.place = place;
  enter(registry, record);
}

function touch(record: DocumentRecord, sequence: number | undefined, action: DocumentAction, details: Omit<DocumentTouch, "sequence" | "action"> = {}): void {
  record.history.push(compact({ sequence, action, ...details }));
}

/** The document, created if new, with this version recorded if it is not already. */
function version(
  registry: DocumentRegistry,
  documentId: string,
  payload: Record<string, unknown>,
  content: unknown,
  authorId: string | undefined,
  sequence: number | undefined,
  place: DocumentPlace,
): DocumentRecord {
  let record = registry.documents[documentId];
  if (!record) {
    record = { id: documentId, versions: [], place, history: [] };
    registry.documents[documentId] = record;
    registry.order.push(documentId);
    enter(registry, record);
  }
  const number = versionOf(payload);
  if (record.versions.every((existing) => existing.version !== number)) {
    const title = payload.title;
    record.versions.push(
      compact({
        version: number,
        title: typeof title === "string" ? title : title ? String(title) : "",
        content,
        authorId,
        createdSequence: sequence,
      }),
    );
  }
  return record;
}

function heldBy(registry: DocumentRegistry, agentId: string): DocumentRecord[] {
  const place = inHand(agentId);
  return registry.order.map((id) => registry.documents[id]).filter((record) => samePlace(record.place, place));
}

function apply(registry: DocumentRegistry, event: AgentEvent): void {
  const payload = event.payload ?? {};
  const actor = event.actorId;
  const target = event.targetId;
  const sequence = event.sequence;
  const documentId = text(payload.documentId);
  const tableId = text(payload.tableId);

  switch (event.type) {
    case "RUN_STARTED": {
      if (!documentId) return;
      const record = version(registry, documentId, payload, payload.input ?? "", undefined, sequence, inTray());
      move(registry, record, inTray());
      touch(record, sequence, "created");
      return;
    }
    case "AGENT_STARTED": {
      if (!actor) return;
      for (const held of ids(payload.documentIds)) {
        const record = registry.documents[held];
        if (record && !samePlace(record.place, inHand(actor))) {
          move(registry, record, inHand(actor));
          touch(record, sequence, "picked_up", { agentId: actor });
        }
      }
      return;
    }
    case "MESSAGE_SENT": {
      if (!documentId || !actor) return;
      const record = version(registry, documentId, payload, payload.content ?? "", actor, sequence, inHand(actor));
      move(registry, record, inHand(target ?? actor));
      touch(record, sequence, "handed", { agentId: actor, peerId: target, version: versionOf(payload) });
      return;
    }
    case "MESSAGE_RECEIVED": {
      if (!documentId || !actor) return;
      // The sender is the target of a RECEIVED event.
      const record = version(registry, documentId, payload, payload.content ?? "", target, sequence, inHand(actor));
      move(registry, record, inHand(actor));
      touch(record, sequence, "received", { agentId: actor, peerId: target });
      return;
    }
    case "AGENT_FINISHED": {
      if (!actor) return;
      for (const record of heldBy(registry, actor)) {
        move(registry, record, filedBy(actor));
        touch(record, sequence, "filed", { agentId: actor });
      }
      return;
    }
    case "DOCUMENT_WRITTEN": {
      if (!documentId || !tableId || !actor) return;
      const record = version(registry, documentId, payload, payload.content ?? "", actor, sequence, onTable(tableId));
      move(registry, record, onTable(tableId));
      touch(record, sequence, "written", { agentId: actor, tableId, version: versionOf(payload) });
      return;
    }
    case "DOCUMENT_READ": {
      if (!tableId || !actor) return;
      for (const read of ids(payload.documentIds)) {
        const record = registry.documents[read];
        if (record) touch(record, sequence, "read", { agentId: actor, tableId });
      }
      return;
    }
    case "DOCUMENT_TAKEN": {
      if (!documentId || !actor) return;
      const record = registry.documents[documentId];
      if (!record) return;
      move(registry, record, inHand(actor));
      touch(record, sequence, "taken", { agentId: actor, tableId });
      return;
    }
    case "RUN_FINISHED": {
      if (!documentId) return;
      const author = text(payload.authorId);
      const record = version(registry, documentId, payload, payload.output ?? "", author, sequence, outTray());
      move(registry, record, outTray());
      touch(record, sequence, "delivered", { agentId: author });
      return;
    }
    default:
      return; // every other event leaves the documents where they are
  }
}

/** Every document of a run, derived from nothing but its events. */
export function foldDocuments(events: readonly AgentEvent[]): DocumentRegistry {
  const registry: DocumentRegistry = { documents: {}, order: [], tables: {} };
  for (const event of events) apply(registry, event);
  return registry;
}

/** The documents an agent wrote, held, read or was handed, in creation order. */
export function documentsTouchedBy(registry: DocumentRegistry, agentId: string): DocumentRecord[] {
  return registry.order
    .map((id) => registry.documents[id])
    .filter(
      (record) =>
        record.versions.some((candidate) => candidate.authorId === agentId) ||
        record.history.some((entry) => entry.agentId === agentId || entry.peerId === agentId),
    );
}
