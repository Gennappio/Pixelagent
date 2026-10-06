import { describe, expect, it } from "vitest";
import { foldDocuments } from "../protocol/documents";
import { demoEvents, tablesEvents } from "../testing/demoRun";
import { contentText, describePlace, describeTouch, excerpt } from "./documentView";

const names = { anna: "Anna", luca: "Luca", gianni: "Gianni", board: "Board", todo: "To research" };

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
  const history = (events: typeof demoEvents, id: string) =>
    foldDocuments(events).documents[id].history.map((touch) => `#${touch.sequence} ${describeTouch(touch, names)}`);

  it("tells the story of a message sheet", () => {
    expect(history(demoEvents, "doc_1")).toEqual(["#4 Anna handed it to Luca", "#6 Luca received it from Anna", "#13 Luca filed it"]);
  });

  it("tells the story of the task and of the result", () => {
    expect(history(demoEvents, "doc_input")).toEqual(["#1 Arrived in the in-tray as the task", "#2 Anna picked it up", "#5 Anna filed it"]);
    expect(history(demoEvents, "doc_3")).toEqual(["#20 Gianni put it in the out-tray"]);
  });

  it("tells the story of a sheet rewritten on a shared table", () => {
    expect(history(tablesEvents, "doc_3")).toEqual([
      "#6 Anna put it on the table “Board”",
      "#10 Luca read it on the table “Board”",
      "#13 Luca put version 2 on the table “Board”",
      "#19 Luca put version 3 on the table “Board”",
      "#25 Gianni read it on the table “Board”",
    ]);
  });

  it("tells the story of a sheet taken from a pile", () => {
    expect(history(tablesEvents, "doc_1")).toEqual([
      "#4 Anna put it on the table “To research”",
      "#9 Luca took it from the table “To research”",
      "#14 Luca filed it",
    ]);
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
