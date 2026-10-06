import { describe, expect, it } from "vitest";
import { demoEvents, eventOfType, parallelEvents, tablesEvents } from "../testing/demoRun";
import { EVERYTHING, lanesConflict, lanesHeld, lanesOfAction, laneSpans } from "./lanes";
import { mapEventToActions } from "./VisualEventMapper";
import type { VisualAction } from "./visualActions";

const spansOf = (event: (typeof demoEvents)[number]) => laneSpans(event, mapEventToActions(event));
const types = (event: (typeof demoEvents)[number]) => mapEventToActions(event).map((action) => action.type);

describe("lanesOfAction", () => {
  it("names the entities each kind of action touches", () => {
    const cases: [VisualAction, string[]][] = [
      [{ type: "RESET" }, [EVERYTHING]],
      [{ type: "WAIT", ms: 300 }, []],
      [{ type: "MOVE_TO", agentId: "anna", target: { kind: "agent", id: "luca" } }, ["agent:anna", "agent:luca"]],
      [{ type: "MOVE_TO", agentId: "luca", target: { kind: "station", id: "web_search" } }, ["agent:luca", "station:web_search"]],
      [{ type: "MOVE_TO", agentId: "luca", target: { kind: "table", id: "board" } }, ["agent:luca", "table:board"]],
      [{ type: "RETURN_TO_POSITION", agentId: "anna" }, ["agent:anna"]],
      [{ type: "TALK", agentId: "anna" }, ["agent:anna"]],
      [{ type: "SET_STATUS", agentId: "anna", status: "idle" }, ["agent:anna"]],
      [{ type: "FILE_DOCUMENTS", agentId: "anna" }, ["agent:anna"]],
      [{ type: "SHOW_TOOL_ICON", tool: "web_search", agentId: "luca" }, ["station:web_search", "agent:luca"]],
      [{ type: "HIDE_TOOL_ICON", tool: "web_search" }, ["station:web_search"]],
      [{ type: "SHOW_DOCUMENT", documentId: "doc_1", title: "", version: 1, at: { kind: "tray", tray: "in" } }, ["document:doc_1", "tray:in"]],
      [{ type: "HAND_DOCUMENT", documentId: "doc_1", to: { kind: "hand", agentId: "luca" } }, ["document:doc_1", "agent:luca"]],
      [{ type: "PLACE_DOCUMENT", documentId: "doc_1", to: { kind: "table", tableId: "board" } }, ["document:doc_1", "table:board"]],
      [{ type: "TAKE_DOCUMENT", documentId: "doc_1", to: { kind: "hand", agentId: "luca" } }, ["document:doc_1", "agent:luca"]],
    ];
    for (const [action, lanes] of cases) expect(lanesOfAction(action), action.type).toEqual(lanes);
  });
});

describe("laneSpans", () => {
  it("gives the recipient back once the sheet is handed over, while the sender walks home", () => {
    const sent = eventOfType("MESSAGE_SENT", "anna");
    const order = types(sent);
    const spans = spansOf(sent);
    expect(spans.get("agent:luca")).toBe(order.indexOf("HAND_DOCUMENT"));
    expect(spans.get("document:doc_1")).toBe(order.indexOf("HAND_DOCUMENT"));
    expect(spans.get("agent:anna")).toBe(order.indexOf("RETURN_TO_POSITION"));
    expect(order.indexOf("HAND_DOCUMENT")).toBeLessThan(order.indexOf("RETURN_TO_POSITION"));
  });

  it("frees a tool station when the result is in, before the agent is back at its desk", () => {
    const result = eventOfType("TOOL_RESULT", "luca");
    const spans = spansOf(result);
    expect(spans.get("station:web_search")).toBe(types(result).indexOf("HIDE_TOOL_ICON"));
    expect(spans.get("agent:luca")).toBe(types(result).length - 1);
  });

  it("frees a table once the sheet is on it", () => {
    const written = eventOfType("DOCUMENT_WRITTEN", "sorter", tablesEvents);
    const spans = spansOf(written);
    expect(spans.get("table:todo")).toBe(types(written).indexOf("PLACE_DOCUMENT"));
    expect(spans.get("agent:sorter")).toBe(types(written).indexOf("RETURN_TO_POSITION"));
  });

  it("keeps everyone involved waiting through a pause", () => {
    // TOOL_CALL ends on a pause: the agent is at work, and the station is in use, for all of it.
    const call = eventOfType("TOOL_CALL", "luca");
    const last = types(call).length - 1;
    expect(types(call)[last]).toBe("WAIT");
    expect(spansOf(call)).toEqual(
      new Map([
        ["agent:luca", last],
        ["station:web_search", last],
      ]),
    );
  });

  it("makes the run starting, finishing or failing concern the whole office, to the end", () => {
    for (const event of [eventOfType("RUN_STARTED"), eventOfType("RUN_FINISHED")]) {
      expect(spansOf(event).get(EVERYTHING), event.type).toBe(types(event).length - 1);
    }
    const failed = { ...eventOfType("RUN_FINISHED"), type: "RUN_ERROR" as const, actorId: "luca", payload: { message: "boom" } };
    expect(spansOf(failed).get(EVERYTHING)).toBe(types(failed).length - 1);
  });

  it("claims nothing for an event that shows nothing", () => {
    const nobody = { ...eventOfType("DECISION", "anna"), actorId: undefined };
    expect(mapEventToActions(nobody)).toEqual([]);
    expect(spansOf(nobody).size).toBe(0);
  });

  it("puts the two parallel workers on lanes that do not meet", () => {
    const [luca, gianni] = parallelEvents.filter((event) => event.type === "TOOL_CALL").map(spansOf);
    expect([...luca.keys()].filter((lane) => gianni.has(lane))).toEqual([]);
  });
});

describe("lanesHeld and lanesConflict", () => {
  const spans = new Map([
    ["agent:anna", 7],
    ["agent:luca", 5],
    ["document:doc_1", 5],
  ]);

  it("holds every lane before the event starts and fewer as its actions complete", () => {
    expect(lanesHeld(spans, 0)).toEqual(["agent:anna", "agent:luca", "document:doc_1"]);
    expect(lanesHeld(spans, 5)).toEqual(["agent:anna", "agent:luca", "document:doc_1"]);
    expect(lanesHeld(spans, 6)).toEqual(["agent:anna"]);
    expect(lanesHeld(spans, 8)).toEqual([]);
  });

  it("makes an event wait only for a lane that is still held", () => {
    const lucaOnly = new Map([["agent:luca", 0]]);
    expect(lanesConflict(lanesHeld(spans, 5), lucaOnly)).toBe(true);
    expect(lanesConflict(lanesHeld(spans, 6), lucaOnly)).toBe(false);
    expect(lanesConflict(lanesHeld(spans, 6), new Map([["agent:anna", 0]]))).toBe(true);
  });

  it("makes everything wait for the whole office, and the whole office for everything", () => {
    const everything = new Map([[EVERYTHING, 0]]);
    expect(lanesConflict(["agent:gianni"], everything)).toBe(true);
    expect(lanesConflict([EVERYTHING], new Map([["agent:gianni", 0]]))).toBe(true);
  });

  it("never makes an event with nothing to show wait, or be waited for", () => {
    expect(lanesConflict([EVERYTHING], new Map())).toBe(false);
    expect(lanesConflict([], new Map([[EVERYTHING, 0]]))).toBe(false);
  });
});
