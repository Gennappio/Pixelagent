import { describe, expect, it } from "vitest";
import type { AgentScript } from "../protocol/workflow";
import { demoWorkflow, parallelWorkflow } from "../testing/demoRun";
import { scriptedSheet, setLine, setLineFor, setLinePerRecipient, setSheet, setSheetMode, sheetMode } from "./scriptEdits";

const scriptOf = (workflow: typeof demoWorkflow, agentId: string) => workflow.agents.find((agent) => agent.id === agentId)!.model.script;

describe("reading a script", () => {
  it("tells a sheet of its own from none at all from whatever it finds or holds", () => {
    expect(sheetMode(undefined)).toBe("default");
    expect(sheetMode({ says: "Hello." })).toBe("default");
    expect(sheetMode({ sheet: { title: "Notes", content: "x" } })).toBe("sheet");
    expect(sheetMode({ sheet: false })).toBe("none");
    // The shipped workflows: Anna passes the task on, Luca writes, Gianni of the two desks only talks.
    expect(sheetMode(scriptOf(demoWorkflow, "anna"))).toBe("default");
    expect(sheetMode(scriptOf(demoWorkflow, "luca"))).toBe("sheet");
    expect(sheetMode(scriptOf(parallelWorkflow, "gianni"))).toBe("none");
  });

  it("reads a script from before hand-offs had words: the message is the sheet", () => {
    const old: AgentScript = { message: "Send this result to management: {result}" };
    expect(sheetMode(old)).toBe("sheet");
    expect(scriptedSheet(old)).toEqual({ title: "", content: "Send this result to management: {result}" });
    expect(scriptedSheet(scriptOf(demoWorkflow, "luca"))).toEqual({ title: "Sales number", content: "{result}" });
    expect(scriptedSheet(undefined)).toEqual({ title: "", content: "" });
  });
});

describe("changing a script", () => {
  it("sets one line for everyone, and leaves nothing behind when it is emptied", () => {
    expect(setLine(undefined, "Go ahead.")).toEqual({ says: "Go ahead." });
    expect(setLine({ says: "Go ahead." }, "")).toBeUndefined();
    expect(setLine({ sheet: false }, "Go ahead.")).toEqual({ says: "Go ahead.", sheet: false });
  });

  it("sets a line for one recipient and keeps the others", () => {
    const both = setLineFor(setLineFor(undefined, "luca", "One."), "gianni", "Two.");
    expect(both).toEqual({ says: { luca: "One.", gianni: "Two." } });
    expect(setLineFor(both, "luca", "")).toEqual({ says: { gianni: "Two." } });
    // A line for each stays a line for each while they are all still empty.
    expect(setLineFor({ says: { luca: "One." } }, "luca", "")).toEqual({ says: {} });
  });

  it("goes from one line for all to a line for each, and back", () => {
    const each = setLinePerRecipient({ says: "Hello." }, true, ["luca", "gianni"]);
    expect(each).toEqual({ says: { luca: "Hello.", gianni: "Hello." } });
    expect(setLinePerRecipient(undefined, true, ["luca", "gianni"])).toEqual({ says: {} });
    expect(setLinePerRecipient({ says: { gianni: "Two.", luca: "One." } }, false, ["luca", "gianni"])).toEqual({ says: "One." });
    expect(setLinePerRecipient({ says: { gianni: "Two." } }, false, ["luca", "gianni"])).toEqual({ says: "Two." });
    expect(setLinePerRecipient({ says: {} }, false, ["luca"])).toBeUndefined();
    // Already the way it is asked to be: nothing changes.
    expect(setLinePerRecipient(each, true, ["luca"])).toBe(each);
  });

  it("switches what it writes without losing what it says", () => {
    const talking = { says: "Done." };
    expect(setSheetMode(talking, "none")).toEqual({ says: "Done.", sheet: false });
    expect(setSheetMode(talking, "sheet")).toEqual({ says: "Done.", sheet: { content: "" } });
    expect(setSheetMode({ says: "Done.", sheet: { title: "Notes", content: "x" } }, "default")).toEqual(talking);
    expect(setSheetMode({ sheet: false }, "default")).toBeUndefined();
  });

  it("edits the sheet, keeping an old message as its content and leaving an empty title unsaid", () => {
    expect(setSheet(undefined, { content: "{result}" })).toEqual({ sheet: { content: "{result}" } });
    expect(setSheet({ sheet: { content: "{result}" } }, { title: "Sales number" })).toEqual({ sheet: { title: "Sales number", content: "{result}" } });
    expect(setSheet({ sheet: { title: "Sales number", content: "{result}" } }, { title: "" })).toEqual({ sheet: { content: "{result}" } });
    // The old key is gone once the sheet is edited, and what it said is not.
    expect(setSheet({ message: "Found: {result}" }, { title: "Finding" })).toEqual({ sheet: { title: "Finding", content: "Found: {result}" } });
    expect(setSheetMode({ message: "Found: {result}" }, "sheet")).toEqual({ sheet: { content: "Found: {result}" } });
    // Until then a script from an old file is left as it is.
    expect(setLine({ message: "Found: {result}" }, "Here.")).toEqual({ says: "Here.", message: "Found: {result}" });
  });
});
