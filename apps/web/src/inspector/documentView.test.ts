import { describe, expect, it } from "vitest";
import { foldDocuments } from "../protocol/documents";
import { demoEvents, everyRun, oldDemoEvents, parallelEvents, tablesEvents } from "../testing/demoRun";
import { contentText, describePlace, describeTouch, excerpt } from "./documentView";

const names = { anna: "Anna", luca: "Luca", gianni: "Gianni", marta: "Marta", sorter: "Sorter", stapler: "Stapler", board: "Board", todo: "To research", done: "Researched" };

describe("describePlace", () => {
  it("names every place a sheet can be", () => {
    expect(describePlace({ kind: "tray", tray: "in" }, names)).toBe("In the in-tray");
    expect(describePlace({ kind: "tray", tray: "out" }, names)).toBe("In the out-tray");
    expect(describePlace({ kind: "hand", agentId: "luca" }, names)).toBe("In Luca’s hands");
    expect(describePlace({ kind: "table", tableId: "board" }, names)).toBe("On the table “Board”");
    expect(describePlace({ kind: "filed", agentId: "anna" }, names)).toBe("Filed by Anna");
    expect(describePlace({ kind: "hand", agentId: "agent_x" }, {})).toBe("In agent_x’s hands");
  });
});

describe("describeTouch", () => {
  const history = (events: typeof demoEvents, id: string) => foldDocuments(events).documents[id].history.map((touch) => describeTouch(touch, names));

  it("tells the story of a sheet an agent wrote and handed on", () => {
    expect(history(demoEvents, "doc_1")).toEqual(["Luca handed it to Gianni", "Gianni received it from Luca", "Gianni filed it"]);
  });

  it("tells the story of the task, passed on as it is, and of the result", () => {
    expect(history(demoEvents, "doc_input")).toEqual([
      "Arrived in the in-tray as the task",
      "Anna picked it up",
      "Anna handed it to Luca",
      "Luca received it from Anna",
      "Luca filed it",
    ]);
    expect(history(demoEvents, "doc_2")).toEqual(["Gianni put it in the out-tray"]);
  });

  it("tells the story of a photocopy, and of a sheet rewritten by whoever was handed it", () => {
    // Anna hands the task to Luca and a photocopy of it to Gianni.
    expect(history(parallelEvents, "doc_1")).toEqual(["Anna handed it to Gianni", "Gianni received it from Anna", "Gianni filed it"]);
    // Marta rewrites the sheet Luca handed her: it is filed with her turn, and comes back out as the result.
    expect(history(parallelEvents, "doc_2")).toEqual(["Luca handed it to Marta", "Marta received it from Luca", "Marta filed it", "Marta put it in the out-tray"]);
    expect(describeTouch({ action: "handed", agentId: "luca", peerId: "gianni", version: 2 }, names)).toBe("Luca handed version 2 to Gianni");
    expect(describeTouch({ action: "handed", agentId: "luca", peerId: "gianni", version: 1 }, names)).toBe("Luca handed it to Gianni");
  });

  it("tells the story of a sheet rewritten on a shared table", () => {
    expect(history(tablesEvents, "doc_5")).toEqual([
      "Luca put it on the table “Board”",
      "Luca put version 2 on the table “Board”",
      "Gianni read it on the table “Board”",
    ]);
  });

  it("tells the story of a sheet taken from a pile", () => {
    expect(history(tablesEvents, "doc_2")).toEqual(["Sorter put it on the table “To research”", "Luca took it from the table “To research”", "Luca filed it"]);
  });

  it("tells the story of a sheet a collector gathered and passed on", () => {
    expect(history(tablesEvents, "doc_4")).toEqual(["Luca put it on the table “Researched”", "Stapler took it from the table “Researched”", "Stapler filed it"]);
    expect(history(tablesEvents, "doc_7")).toEqual(["Stapler handed it to Gianni", "Gianni received it from Stapler", "Gianni filed it"]);
  });

  it("tells the story of a sheet from a log of revision 2, made for one hand-off", () => {
    expect(history(oldDemoEvents, "doc_1")).toEqual(["Anna handed it to Luca", "Luca received it from Anna", "Luca filed it"]);
    expect(history(oldDemoEvents, "doc_input")).toEqual(["Arrived in the in-tray as the task", "Anna picked it up", "Anna filed it"]);
  });

  it("points every line of every story at the event it tells of", () => {
    const told = {
      created: "RUN_STARTED",
      picked_up: "AGENT_STARTED",
      handed: "MESSAGE_SENT",
      received: "MESSAGE_RECEIVED",
      filed: "AGENT_FINISHED",
      written: "DOCUMENT_WRITTEN",
      read: "DOCUMENT_READ",
      taken: "DOCUMENT_TAKEN",
      delivered: "RUN_FINISHED",
    };
    for (const { name, events } of everyRun) {
      const registry = foldDocuments(events);
      const touches = registry.order.flatMap((id) => registry.documents[id].history);
      expect(touches.length, name).toBeGreaterThan(5);
      for (const touch of touches) {
        const event = events.find((candidate) => candidate.sequence === touch.sequence);
        expect(event?.type, `${name} #${touch.sequence} ${touch.action}`).toBe(told[touch.action]);
      }
    }
  });

  it("has a sentence for a result nobody signed", () => {
    expect(describeTouch({ action: "delivered" }, names)).toBe("Put in the out-tray as the result");
  });
});

describe("contentText and excerpt", () => {
  it("keeps text as it is and formats anything else as JSON", () => {
    expect(contentText("two\nlines")).toBe("two\nlines");
    expect(contentText({ total: 3 })).toBe('{\n  "total": 3\n}');
    expect(contentText(undefined)).toBe("");
    expect(contentText(null)).toBe("");
    expect(contentText(0)).toBe("0");
  });

  it("shortens long or multi-line content to one line", () => {
    expect(excerpt("short")).toBe("short");
    expect(excerpt("1 of 2 suppliers researched.\nA: reliable, 30 days delivery.", 30)).toBe("1 of 2 suppliers researched.…");
    expect(excerpt("x".repeat(100)).length).toBe(48);
    expect(excerpt("x".repeat(100)).endsWith("…")).toBe(true);
  });
});
