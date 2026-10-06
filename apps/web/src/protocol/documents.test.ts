import { describe, expect, it } from "vitest";
import { demoEvents, demoRegistry, everyRun, oldRuns, parallelEvents, parallelRegistry, sequenceOf, tablesEvents, tablesRegistry } from "../testing/demoRun";
import { documentsTouchedBy, filedBy, foldDocuments, inHand, inTray, latestVersion, onTable, outTray, samePlace } from "./documents";
import type { AgentEvent, AgentEventType } from "./events";

let sequence = 0;
function event(type: AgentEventType, actorId: string | undefined, payload: Record<string, unknown>, targetId?: string): AgentEvent {
  sequence += 1;
  return { id: `e${sequence}`, runId: "r", sequence, timestamp: "t", type, actorId, targetId, payload };
}

const written = (actor: string, tableId: string, documentId: string, version = 1, content = "…") =>
  event("DOCUMENT_WRITTEN", actor, { tableId, documentId, version, title: "Notes", content });

/** A hand-off as revision 3 writes it: something said, and a sheet only when there is one. */
const said = (actor: string, target: string, message: string, sheet: Record<string, unknown> = {}) => event("MESSAGE_SENT", actor, { message, ...sheet }, target);

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

  it("on the logs written before a hand-off had words of its own, as the server folded them then", () => {
    expect(oldRuns).toHaveLength(3);
    for (const run of oldRuns) {
      // They really are the old shape: a sheet every time, and nothing said.
      const sent = run.events.filter((entry) => entry.type === "MESSAGE_SENT");
      expect(sent.length, run.name).toBeGreaterThan(0);
      expect(sent.every((entry) => !("message" in entry.payload) && typeof entry.payload.documentId === "string")).toBe(true);
      expect(foldDocuments(run.events), run.name).toStrictEqual(run.registry);
    }
  });

  it("after every single event of every run, old and new, not only at the end", () => {
    for (const { name, events, places } of everyRun) {
      expect(places).toHaveLength(events.length);
      events.forEach((_, index) => {
        const partial = foldDocuments(events.slice(0, index + 1));
        const where = Object.fromEntries(partial.order.map((id) => [id, partial.documents[id].place]));
        expect(where, `${name}, after event #${index + 1}`).toStrictEqual(places[index]);
      });
    }
  });

  it("keeps its own books straight at every step", () => {
    for (const { events } of everyRun) {
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
  it("follows the task from the in-tray to a hand, to another hand, to the files", () => {
    const placeAfter = (count: number, id: string) => foldDocuments(demoEvents.slice(0, count)).documents[id]?.place;
    const after = (type: AgentEventType, actor?: string) => sequenceOf(demoEvents, type, actor);
    expect(placeAfter(after("RUN_STARTED"), "doc_input")).toEqual(inTray());
    expect(placeAfter(after("AGENT_STARTED", "anna"), "doc_input")).toEqual(inHand("anna"));
    // Anna passes it on as it is: the same sheet, now Luca's to hold. She has nothing left to file.
    expect(placeAfter(after("MESSAGE_SENT", "anna"), "doc_input")).toEqual(inHand("luca"));
    expect(placeAfter(after("AGENT_FINISHED", "anna"), "doc_input")).toEqual(inHand("luca"));
    // Luca writes a sheet of his own, hands that one on and files the task.
    expect(placeAfter(after("MESSAGE_SENT", "luca") - 1, "doc_1")).toBeUndefined();
    expect(placeAfter(after("MESSAGE_SENT", "luca"), "doc_1")).toEqual(inHand("gianni"));
    expect(placeAfter(after("MESSAGE_SENT", "luca"), "doc_input")).toEqual(inHand("luca"));
    expect(placeAfter(after("AGENT_FINISHED", "luca"), "doc_input")).toEqual(filedBy("luca"));
    expect(placeAfter(demoEvents.length, "doc_2")).toEqual(outTray());
    expect(Object.keys(foldDocuments(demoEvents).documents)).toEqual(["doc_input", "doc_1", "doc_2"]);
  });

  it("leaves the documents as they were when something is said and nothing handed over", () => {
    const task = event("RUN_STARTED", undefined, { input: "go", documentId: "doc_input", title: "Task" });
    const before = foldDocuments([task]);
    const spoken = [said("anna", "luca", "Go ahead."), event("MESSAGE_RECEIVED", "luca", { message: "Go ahead." }, "anna")];
    expect(foldDocuments([task, ...spoken])).toStrictEqual(before);
    // The real thing: Gianni only tells Marta, in the run of the two desks.
    const told = parallelEvents.findIndex((entry) => entry.type === "MESSAGE_SENT" && entry.actorId === "gianni");
    expect(parallelEvents[told].payload).toEqual({ message: "Management has been warned." });
    expect(foldDocuments(parallelEvents.slice(0, told + 1))).toStrictEqual(foldDocuments(parallelEvents.slice(0, told)));
  });

  it("keeps a sheet that is passed on the same document, by the same author", () => {
    const sheet = { documentId: "doc_1", version: 1, title: "Notes", content: "first" };
    const notes = foldDocuments([said("anna", "luca", "Here.", sheet), said("luca", "gianni", "", sheet)]).documents.doc_1;
    expect(notes.place).toEqual(inHand("gianni"));
    expect(notes.versions.map((entry) => [entry.version, entry.authorId])).toEqual([[1, "anna"]]);
    expect(notes.history.map((entry) => [entry.action, entry.agentId, entry.peerId])).toEqual([
      ["handed", "anna", "luca"],
      ["handed", "luca", "gianni"],
    ]);
  });

  it("records a new version written in someone's hands", () => {
    const notes = foldDocuments([
      said("anna", "luca", "Check this.", { documentId: "doc_1", version: 1, title: "Notes", content: "first" }),
      said("luca", "gianni", "Checked.", { documentId: "doc_1", version: 2, title: "Notes", content: "second" }),
    ]).documents.doc_1;
    expect(notes.versions.map((entry) => [entry.version, entry.authorId, entry.content])).toEqual([
      [1, "anna", "first"],
      [2, "luca", "second"],
    ]);
    // The real thing: Marta rewrites the sheet Luca handed her, and that is the result.
    const sales = foldDocuments(parallelEvents).documents.doc_2;
    expect(sales.versions.map((entry) => [entry.version, entry.authorId])).toEqual([
      [1, "luca"],
      [2, "marta"],
    ]);
    expect(sales.place).toEqual(outTray());
  });

  it("remembers which sheet a photocopy was made from", () => {
    const sheet = { version: 1, title: "Notes", content: "same" };
    const registry = foldDocuments([said("anna", "luca", "", { documentId: "doc_1", ...sheet }), said("anna", "gianni", "", { documentId: "doc_2", copyOf: "doc_1", ...sheet })]);
    expect("copyOf" in registry.documents.doc_1).toBe(false);
    expect(registry.documents.doc_2.copyOf).toBe("doc_1");
    // A copy is a sheet of its own: each is where it was handed.
    expect([registry.documents.doc_1.place, registry.documents.doc_2.place]).toEqual([inHand("luca"), inHand("gianni")]);
    // The real thing: Anna hands the task to Luca and a photocopy of it to Gianni.
    expect(foldDocuments(parallelEvents).documents.doc_1.copyOf).toBe("doc_input");
    for (const copyOf of ["", 7, null]) {
      expect("copyOf" in foldDocuments([said("anna", "luca", "", { documentId: "doc_1", copyOf, ...sheet })]).documents.doc_1).toBe(false);
    }
  });

  it("delivers as the result a sheet that already exists", () => {
    const notes = foldDocuments([
      said("anna", "luca", "", { documentId: "doc_1", version: 1, title: "Notes", content: "first" }),
      event("AGENT_FINISHED", "luca", { output: "second" }),
      event("RUN_FINISHED", undefined, { output: "second", documentId: "doc_1", version: 2, title: "Notes", authorId: "luca" }),
    ]).documents.doc_1;
    expect(notes.place).toEqual(outTray());
    expect(notes.versions.map((entry) => [entry.version, entry.authorId, entry.content])).toEqual([
      [1, "anna", "first"],
      [2, "luca", "second"],
    ]);
    expect(notes.history.map((entry) => entry.action)).toEqual(["handed", "filed", "delivered"]);
  });

  it("keeps every version of a shared sheet, latest last", () => {
    const board = foldDocuments(tablesEvents).documents.doc_5;
    const writes = tablesEvents.filter((entry) => entry.type === "DOCUMENT_WRITTEN" && entry.payload.tableId === "board").map((entry) => entry.sequence);
    expect(writes).toHaveLength(2);
    // Each version remembers the event that wrote it.
    expect(board.versions.map((entry) => [entry.version, entry.authorId, entry.createdSequence])).toEqual([
      [1, "luca", writes[0]],
      [2, "luca", writes[1]],
    ]);
    expect(latestVersion(board).content).toBe("Supplier B: cheaper, 60 days delivery");
    expect(board.versions[0].content).toBe("Supplier A: reliable, 30 days delivery");
    expect(board.place).toEqual(onTable("board"));
  });

  it("takes sheets off a pile one at a time", () => {
    const pileAfter = (count: number) => foldDocuments(tablesEvents.slice(0, count)).tables.todo;
    const taken = (actor: string, nth: number) => sequenceOf(tablesEvents, "DOCUMENT_TAKEN", actor, nth);
    expect(pileAfter(taken("luca", 0) - 1)).toEqual(["doc_2", "doc_3"]);
    expect(pileAfter(taken("luca", 0))).toEqual(["doc_3"]);
    expect(pileAfter(taken("luca", 1) - 1)).toEqual(["doc_3"]);
    expect(pileAfter(taken("luca", 1))).toEqual([]);
    // The collector empties its pile in one go: two takes, one after the other.
    const doneAfter = (count: number) => foldDocuments(tablesEvents.slice(0, count)).tables.done;
    expect(taken("stapler", 1)).toBe(taken("stapler", 0) + 1);
    expect(doneAfter(taken("stapler", 0) - 1)).toEqual(["doc_4", "doc_6"]);
    expect(doneAfter(taken("stapler", 1))).toEqual([]);
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
    const registry = foldDocuments([event("MESSAGE_RECEIVED", "luca", { message: "Hello.", content: "hello", documentId: "doc_7", title: "Note", copyOf: "doc_3" }, "anna")]);
    expect(registry.documents.doc_7.versions[0].authorId).toBe("anna");
    expect(registry.documents.doc_7.place).toEqual(inHand("luca"));
    expect(registry.documents.doc_7.copyOf).toBe("doc_3");
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
