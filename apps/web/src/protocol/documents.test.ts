import { describe, expect, it } from "vitest";
import {
  demoEvents,
  demoPlaces,
  demoRegistry,
  parallelEvents,
  parallelPlaces,
  parallelRegistry,
  tablesEvents,
  tablesPlaces,
  tablesRegistry,
} from "../testing/demoRun";
import { documentsTouchedBy, filedBy, foldDocuments, inHand, inTray, latestVersion, onTable, outTray, samePlace } from "./documents";
import type { AgentEvent, AgentEventType } from "./events";

let sequence = 0;
function event(type: AgentEventType, actorId: string | undefined, payload: Record<string, unknown>, targetId?: string): AgentEvent {
  sequence += 1;
  return { id: `e${sequence}`, runId: "r", sequence, timestamp: "t", type, actorId, targetId, payload };
}

const written = (actor: string, tableId: string, documentId: string, version = 1, content = "…") =>
  event("DOCUMENT_WRITTEN", actor, { tableId, documentId, version, title: "Notes", content });

describe("the web fold reads a log exactly as the server does", () => {
  it("on the demo run", () => {
    expect(foldDocuments(demoEvents)).toStrictEqual(demoRegistry);
  });

  it("on a run with tables, versions and a pile", () => {
    expect(foldDocuments(tablesEvents)).toStrictEqual(tablesRegistry);
  });

  it("on a run where two agents work at once", () => {
    expect(foldDocuments(parallelEvents)).toStrictEqual(parallelRegistry);
  });

  it("after every single event of both runs, not only at the end", () => {
    for (const [events, places] of [
      [demoEvents, demoPlaces],
      [tablesEvents, tablesPlaces],
      [parallelEvents, parallelPlaces],
    ] as const) {
      expect(places).toHaveLength(events.length);
      events.forEach((_, index) => {
        const partial = foldDocuments(events.slice(0, index + 1));
        const where = Object.fromEntries(partial.order.map((id) => [id, partial.documents[id].place]));
        expect(where, `after event #${index + 1}`).toStrictEqual(places[index]);
      });
    }
  });

  it("keeps its own books straight at every step", () => {
    for (const events of [demoEvents, tablesEvents, parallelEvents]) {
      for (let count = 0; count <= events.length; count++) {
        const partial = foldDocuments(events.slice(0, count));
        expect(partial.order).toEqual(Object.keys(partial.documents));
        for (const [tableId, onIt] of Object.entries(partial.tables)) {
          expect(onIt).toEqual(partial.order.filter((id) => samePlace(partial.documents[id].place, onTable(tableId))));
        }
      }
    }
  });
});

describe("foldDocuments", () => {
  it("follows a sheet from the in-tray to a hand to the files", () => {
    const placeAfter = (count: number, id: string) => foldDocuments(demoEvents.slice(0, count)).documents[id]?.place;
    expect(placeAfter(1, "doc_input")).toEqual(inTray());
    expect(placeAfter(2, "doc_input")).toEqual(inHand("anna"));
    expect(placeAfter(3, "doc_1")).toBeUndefined();
    expect(placeAfter(4, "doc_1")).toEqual(inHand("luca"));
    expect(placeAfter(5, "doc_input")).toEqual(filedBy("anna"));
    expect(placeAfter(20, "doc_3")).toEqual(outTray());
  });

  it("keeps every version of a shared sheet, latest last", () => {
    const board = foldDocuments(tablesEvents).documents.doc_5;
    expect(board.versions.map((entry) => [entry.version, entry.authorId, entry.createdSequence])).toEqual([
      [1, "luca", 17],
      [2, "luca", 25],
    ]);
    expect(latestVersion(board).content).toBe("Supplier B: cheaper, 60 days delivery");
    expect(board.versions[0].content).toBe("Supplier A: reliable, 30 days delivery");
    expect(board.place).toEqual(onTable("board"));
  });

  it("takes sheets off a pile one at a time", () => {
    const pileAfter = (count: number) => foldDocuments(tablesEvents.slice(0, count)).tables.todo;
    expect(pileAfter(9)).toEqual(["doc_2", "doc_3"]);
    expect(pileAfter(12)).toEqual(["doc_3"]);
    expect(pileAfter(20)).toEqual([]);
    // The collector empties its pile in one go.
    const doneAfter = (count: number) => foldDocuments(tablesEvents.slice(0, count)).tables.done;
    expect(doneAfter(26)).toEqual(["doc_4", "doc_6"]);
    expect(doneAfter(29)).toEqual([]);
  });

  it("does not record the same version twice", () => {
    const once = written("anna", "board", "doc_1");
    expect(foldDocuments([once, once]).documents.doc_1.versions).toHaveLength(1);
  });

  it("treats anything but a positive whole number as version 1", () => {
    for (const version of [undefined, null, 0, -2, 1.5, "3", true]) {
      const registry = foldDocuments([event("DOCUMENT_WRITTEN", "anna", { tableId: "board", documentId: "doc_1", version })]);
      expect(registry.documents.doc_1.versions[0].version).toBe(1);
    }
  });

  it("ignores events about documents it has never seen", () => {
    const registry = foldDocuments([
      event("AGENT_STARTED", "anna", { documentIds: ["doc_nowhere"] }),
      event("DOCUMENT_TAKEN", "anna", { tableId: "todo", documentId: "doc_nowhere" }),
      event("DOCUMENT_READ", "anna", { tableId: "todo", documentIds: ["doc_nowhere"] }),
    ]);
    expect(registry).toEqual({ documents: {}, order: [], tables: {} });
  });

  it("folds a log from before documents existed to nothing", () => {
    const legacy = [
      event("RUN_STARTED", undefined, { input: "old" }),
      event("AGENT_STARTED", "anna", { input: "old" }),
      event("MESSAGE_SENT", "anna", { content: "old" }, "luca"),
      event("AGENT_FINISHED", "anna", { output: "old" }),
      event("RUN_FINISHED", undefined, { output: "old" }),
    ];
    expect(foldDocuments(legacy)).toEqual({ documents: {}, order: [], tables: {} });
  });

  it("yields the sheet of a message even when only its receipt is in the log", () => {
    const registry = foldDocuments([event("MESSAGE_RECEIVED", "luca", { content: "hello", documentId: "doc_7", title: "Note" }, "anna")]);
    expect(registry.documents.doc_7.versions[0].authorId).toBe("anna");
    expect(registry.documents.doc_7.place).toEqual(inHand("luca"));
  });

  it("does not change the events it reads", () => {
    const frozen = JSON.stringify(tablesEvents);
    foldDocuments(tablesEvents);
    expect(JSON.stringify(tablesEvents)).toBe(frozen);
  });
});

describe("documentsTouchedBy", () => {
  it("lists what an agent wrote, held, read or was handed", () => {
    const registry = foldDocuments(tablesEvents);
    const touched = (agentId: string) => documentsTouchedBy(registry, agentId).map((record) => record.id);
    expect(touched("anna")).toEqual(["doc_input", "doc_1"]);
    expect(touched("luca")).toEqual(["doc_2", "doc_3", "doc_4", "doc_5", "doc_6"]);
    expect(touched("stapler")).toEqual(["doc_4", "doc_6", "doc_7"]);
    expect(touched("gianni")).toEqual(["doc_5", "doc_7", "doc_8"]);
  });
});
