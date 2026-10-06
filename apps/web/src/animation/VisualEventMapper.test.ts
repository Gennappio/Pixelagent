import { describe, expect, it } from "vitest";
import { demoEvents, eventOfType, tablesEvents } from "../testing/demoRun";
import { mapEventToActions } from "./VisualEventMapper";

const types = (actions: ReturnType<typeof mapEventToActions>) => actions.map((action) => action.type);

describe("mapEventToActions", () => {
  it("turns MESSAGE_SENT Anna → Luca into: write the sheet, walk over, talk, hand it, walk back", () => {
    const event = eventOfType("MESSAGE_SENT", "anna");
    const actions = mapEventToActions(event);

    expect(types(actions)).toEqual([
      "SHOW_DOCUMENT",
      "MOVE_TO",
      "TALK",
      "SHOW_BUBBLE",
      "HIDE_BUBBLE",
      "HAND_DOCUMENT",
      "SET_STATUS",
      "RETURN_TO_POSITION",
    ]);
    expect(actions[0]).toEqual({
      type: "SHOW_DOCUMENT",
      documentId: "doc_1",
      title: "Message to Luca",
      version: 1,
      at: { kind: "hand", agentId: "anna" },
    });
    expect(actions[1]).toEqual({ type: "MOVE_TO", agentId: "anna", target: { kind: "agent", id: "luca" } });
    expect(actions[3]).toMatchObject({ type: "SHOW_BUBBLE", agentId: "anna", text: "Find the latest sales number.", eventId: event.id });
    expect(actions[5]).toEqual({ type: "HAND_DOCUMENT", documentId: "doc_1", to: { kind: "hand", agentId: "luca" } });
  });

  it("still plays a message from a log that predates documents, without a sheet", () => {
    const legacy = { ...eventOfType("MESSAGE_SENT", "anna"), payload: { content: "Find the latest sales number." } };
    expect(types(mapEventToActions(legacy))).toEqual(["MOVE_TO", "TALK", "SHOW_BUBBLE", "HIDE_BUBBLE", "SET_STATUS", "RETURN_TO_POSITION"]);
  });

  it("puts the task in the in-tray when the run starts", () => {
    expect(mapEventToActions(eventOfType("RUN_STARTED"))).toEqual([
      { type: "RESET" },
      { type: "SHOW_DOCUMENT", documentId: "doc_input", title: "Task", version: 1, at: { kind: "tray", tray: "in" } },
      { type: "WAIT", ms: 300 },
    ]);
  });

  it("has an agent pick up the sheets it starts from", () => {
    const actions = mapEventToActions(eventOfType("AGENT_STARTED", "anna"));
    expect(actions).toContainEqual({ type: "TAKE_DOCUMENT", documentId: "doc_input", to: { kind: "hand", agentId: "anna" } });
  });

  it("files what an agent was holding when it finishes", () => {
    expect(mapEventToActions(eventOfType("AGENT_FINISHED", "luca"))[0]).toEqual({ type: "FILE_DOCUMENTS", agentId: "luca" });
  });

  it("has the author put the result in the out-tray when the run finishes", () => {
    const finished = eventOfType("RUN_FINISHED");
    expect(mapEventToActions(finished).slice(0, 2)).toEqual([
      { type: "SHOW_DOCUMENT", documentId: "doc_3", title: "Result", version: 1, at: { kind: "hand", agentId: "gianni" } },
      { type: "PLACE_DOCUMENT", documentId: "doc_3", to: { kind: "tray", tray: "out" } },
    ]);

    const { authorId: _nobody, ...anonymous } = finished.payload;
    expect(mapEventToActions({ ...finished, payload: anonymous })[0]).toMatchObject({ type: "SHOW_DOCUMENT", at: { kind: "tray", tray: "out" } });
    expect(types(mapEventToActions({ ...finished, payload: { output: "old log" } }))).toEqual(["WAIT"]);
  });

  it("turns TOOL_CALL into a walk to the tool station and work", () => {
    const actions = mapEventToActions(eventOfType("TOOL_CALL", "luca"));
    expect(actions.slice(0, 3)).toEqual([
      { type: "MOVE_TO", agentId: "luca", target: { kind: "station", id: "web_search" } },
      { type: "WORK", agentId: "luca" },
      { type: "SHOW_TOOL_ICON", tool: "web_search", agentId: "luca" },
    ]);
  });

  it("shows the tool result, frees the station and sends the agent home", () => {
    const actions = mapEventToActions(eventOfType("TOOL_RESULT", "luca"));
    expect(actions[0]).toMatchObject({ type: "SHOW_BUBBLE", text: "Sales: €1.2M", kind: "result" });
    expect(types(actions)).toEqual(expect.arrayContaining(["HIDE_TOOL_ICON", "RETURN_TO_POSITION"]));
  });

  it("flags RUN_ERROR on the failing agent with the real message", () => {
    const actions = mapEventToActions({
      ...demoEvents[0],
      type: "RUN_ERROR",
      actorId: "luca",
      payload: { message: "Web search timed out" },
    });
    expect(actions[0]).toEqual({ type: "SHOW_ALERT", agentId: "luca" });
    expect(actions[1]).toMatchObject({ type: "SHOW_BUBBLE", text: "Web search timed out", kind: "error" });
  });

  describe("tables", () => {
    it("turns DOCUMENT_WRITTEN into: write the sheet, walk to the table, put it down, walk back", () => {
      expect(mapEventToActions(eventOfType("DOCUMENT_WRITTEN", "anna", tablesEvents))).toEqual([
        { type: "SHOW_DOCUMENT", documentId: "doc_1", title: "Supplier A", version: 1, at: { kind: "hand", agentId: "anna" } },
        { type: "MOVE_TO", agentId: "anna", target: { kind: "table", id: "todo" } },
        { type: "PLACE_DOCUMENT", documentId: "doc_1", to: { kind: "table", tableId: "todo" } },
        { type: "RETURN_TO_POSITION", agentId: "anna" },
      ]);
    });

    it("shows the new version number when a shared sheet is rewritten", () => {
      const rewrite = tablesEvents.find((event) => event.type === "DOCUMENT_WRITTEN" && event.payload.version === 2)!;
      expect(mapEventToActions(rewrite)[0]).toMatchObject({ type: "SHOW_DOCUMENT", documentId: "doc_3", version: 2 });
    });

    it("turns DOCUMENT_TAKEN into a walk to the table and a sheet in hand", () => {
      expect(mapEventToActions(eventOfType("DOCUMENT_TAKEN", "luca", tablesEvents))).toEqual([
        { type: "MOVE_TO", agentId: "luca", target: { kind: "table", id: "todo" } },
        { type: "TAKE_DOCUMENT", documentId: "doc_1", to: { kind: "hand", agentId: "luca" } },
        { type: "RETURN_TO_POSITION", agentId: "luca" },
      ]);
    });

    it("turns DOCUMENT_READ into a visit that leaves the sheets where they are", () => {
      const actions = mapEventToActions(eventOfType("DOCUMENT_READ", "luca", tablesEvents));
      expect(types(actions)).toEqual(["MOVE_TO", "SET_STATUS", "WAIT", "RETURN_TO_POSITION"]);
      expect(actions[0]).toEqual({ type: "MOVE_TO", agentId: "luca", target: { kind: "table", id: "board" } });
    });
  });

  it("is deterministic and has something to show for every event of both runs", () => {
    for (const event of [...demoEvents, ...tablesEvents]) {
      expect(mapEventToActions(event)).toEqual(mapEventToActions(event));
      expect(mapEventToActions(event).length, event.type).toBeGreaterThan(0);
    }
  });
});
