import { describe, expect, it } from "vitest";
import { demoEvents, eventOfType, everyRun, oldDemoEvents, parallelEvents, tablesEvents } from "../testing/demoRun";
import { mapEventToActions } from "./VisualEventMapper";

const types = (actions: ReturnType<typeof mapEventToActions>) => actions.map((action) => action.type);

describe("mapEventToActions", () => {
  it("turns MESSAGE_SENT Anna → Luca, with a sheet, into: sheet in hand, walk over, say it, hand the sheet over, walk back", () => {
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
    // The task, which she holds and passes on as it is.
    expect(actions[0]).toEqual({
      type: "SHOW_DOCUMENT",
      documentId: "doc_input",
      title: "Task",
      version: 1,
      at: { kind: "hand", agentId: "anna" },
    });
    expect(actions[1]).toEqual({ type: "MOVE_TO", agentId: "anna", target: { kind: "agent", id: "luca" } });
    // The bubble shows what she says, not what is on the sheet.
    expect(actions[3]).toMatchObject({ type: "SHOW_BUBBLE", agentId: "anna", text: "Find the latest sales number.", kind: "speech", eventId: event.id });
    expect(actions[5]).toEqual({ type: "HAND_DOCUMENT", documentId: "doc_input", to: { kind: "hand", agentId: "luca" } });
  });

  it("turns MESSAGE_SENT with words only into: walk over, say it, walk back, and no sheet anywhere", () => {
    const event = eventOfType("MESSAGE_SENT", "gianni", parallelEvents);
    const actions = mapEventToActions(event);
    expect(types(actions)).toEqual(["MOVE_TO", "TALK", "SHOW_BUBBLE", "HIDE_BUBBLE", "SET_STATUS", "RETURN_TO_POSITION"]);
    expect(actions[0]).toEqual({ type: "MOVE_TO", agentId: "gianni", target: { kind: "agent", id: "marta" } });
    expect(actions[2]).toMatchObject({ type: "SHOW_BUBBLE", agentId: "gianni", text: "Management has been warned.", kind: "speech" });
    expect(actions.some((action) => action.type.endsWith("_DOCUMENT"))).toBe(false);
  });

  it("shows the sheet's title in the bubble when it is handed over in silence", () => {
    const actions = mapEventToActions(eventOfType("MESSAGE_SENT", "stapler", tablesEvents));
    expect(types(actions)).toEqual(["SHOW_DOCUMENT", "MOVE_TO", "TALK", "SHOW_BUBBLE", "HIDE_BUBBLE", "HAND_DOCUMENT", "SET_STATUS", "RETURN_TO_POSITION"]);
    expect(actions[3]).toMatchObject({ type: "SHOW_BUBBLE", text: "Researched" });
  });

  it("shows a new version of a sheet in the hand of whoever rewrote it, and a photocopy as a sheet of its own", () => {
    const rewritten = { ...eventOfType("MESSAGE_SENT", "luca"), payload: { message: "Checked.", documentId: "doc_input", version: 2, title: "Task", content: "…" } };
    expect(mapEventToActions(rewritten)[0]).toEqual({ type: "SHOW_DOCUMENT", documentId: "doc_input", title: "Task", version: 2, at: { kind: "hand", agentId: "luca" } });
    const copy = parallelEvents.find((event) => event.type === "MESSAGE_SENT" && event.targetId === "gianni")!;
    const actions = mapEventToActions(copy);
    expect(actions[0]).toEqual({ type: "SHOW_DOCUMENT", documentId: "doc_1", title: "Task", version: 1, at: { kind: "hand", agentId: "anna" } });
    expect(actions[5]).toEqual({ type: "HAND_DOCUMENT", documentId: "doc_1", to: { kind: "hand", agentId: "gianni" } });
  });

  it("has nothing to say for a hand-off with no words and no sheet, and still walks over", () => {
    const empty = { ...eventOfType("MESSAGE_SENT", "anna"), payload: { message: "" } };
    expect(types(mapEventToActions(empty))).toEqual(["MOVE_TO", "SET_STATUS", "RETURN_TO_POSITION"]);
  });

  it("still plays a hand-off from revision 2: the sheet made for it, and what it says in the bubble", () => {
    const old = eventOfType("MESSAGE_SENT", "anna", oldDemoEvents);
    const actions = mapEventToActions(old);
    expect(types(actions)).toEqual(["SHOW_DOCUMENT", "MOVE_TO", "TALK", "SHOW_BUBBLE", "HIDE_BUBBLE", "HAND_DOCUMENT", "SET_STATUS", "RETURN_TO_POSITION"]);
    expect(actions[0]).toMatchObject({ type: "SHOW_DOCUMENT", documentId: "doc_1", title: "Message to Luca" });
    expect(actions[3]).toMatchObject({ type: "SHOW_BUBBLE", text: "Find the latest sales number." });
  });

  it("still plays a message from a log that predates documents, without a sheet", () => {
    const legacy = { ...eventOfType("MESSAGE_SENT", "anna"), payload: { content: "Find the latest sales number." } };
    const actions = mapEventToActions(legacy);
    expect(types(actions)).toEqual(["MOVE_TO", "TALK", "SHOW_BUBBLE", "HIDE_BUBBLE", "SET_STATUS", "RETURN_TO_POSITION"]);
    expect(actions[2]).toMatchObject({ type: "SHOW_BUBBLE", text: "Find the latest sales number." });
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
      { type: "SHOW_DOCUMENT", documentId: "doc_2", title: "Email sent", version: 1, at: { kind: "hand", agentId: "gianni" } },
      { type: "PLACE_DOCUMENT", documentId: "doc_2", to: { kind: "tray", tray: "out" } },
    ]);
    // A result that is a new version of a sheet its author was handed: the same sheet, back in hand, then out.
    expect(mapEventToActions(eventOfType("RUN_FINISHED", undefined, parallelEvents)).slice(0, 2)).toEqual([
      { type: "SHOW_DOCUMENT", documentId: "doc_2", title: "Sales number", version: 2, at: { kind: "hand", agentId: "marta" } },
      { type: "PLACE_DOCUMENT", documentId: "doc_2", to: { kind: "tray", tray: "out" } },
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

  it("animates a tool the runtime consulted exactly like one the agent chose", () => {
    const consulted = eventOfType("TOOL_CALL", "luca", tablesEvents);
    expect(consulted.payload.required).toBe(true);
    const { required: _workflow, ...chosen } = consulted.payload;
    expect(mapEventToActions(consulted)).toEqual(mapEventToActions({ ...consulted, payload: chosen }));
    expect(types(mapEventToActions(consulted))).toEqual(["MOVE_TO", "WORK", "SHOW_TOOL_ICON", "WAIT"]);
    // Only the thought before it is missing: nobody decided.
    expect(tablesEvents[consulted.sequence - 2].type).not.toBe("DECISION");
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
      expect(mapEventToActions(eventOfType("DOCUMENT_WRITTEN", "sorter", tablesEvents))).toEqual([
        { type: "SHOW_DOCUMENT", documentId: "doc_2", title: "Supplier A", version: 1, at: { kind: "hand", agentId: "sorter" } },
        { type: "MOVE_TO", agentId: "sorter", target: { kind: "table", id: "todo" } },
        { type: "PLACE_DOCUMENT", documentId: "doc_2", to: { kind: "table", tableId: "todo" } },
        { type: "RETURN_TO_POSITION", agentId: "sorter" },
      ]);
    });

    it("shows the new version number when a shared sheet is rewritten", () => {
      const rewrite = tablesEvents.find((event) => event.type === "DOCUMENT_WRITTEN" && event.payload.version === 2)!;
      expect(mapEventToActions(rewrite)[0]).toMatchObject({ type: "SHOW_DOCUMENT", documentId: "doc_5", title: "Finding", version: 2 });
    });

    it("turns DOCUMENT_TAKEN into a walk to the table and a sheet in hand", () => {
      expect(mapEventToActions(eventOfType("DOCUMENT_TAKEN", "luca", tablesEvents))).toEqual([
        { type: "MOVE_TO", agentId: "luca", target: { kind: "table", id: "todo" } },
        { type: "TAKE_DOCUMENT", documentId: "doc_2", to: { kind: "hand", agentId: "luca" } },
        { type: "RETURN_TO_POSITION", agentId: "luca" },
      ]);
    });

    it("turns DOCUMENT_READ into a visit that leaves the sheets where they are", () => {
      const actions = mapEventToActions(eventOfType("DOCUMENT_READ", "gianni", tablesEvents));
      expect(types(actions)).toEqual(["MOVE_TO", "SET_STATUS", "WAIT", "RETURN_TO_POSITION"]);
      expect(actions[0]).toEqual({ type: "MOVE_TO", agentId: "gianni", target: { kind: "table", id: "board" } });
    });
  });

  it("is deterministic and has something to show for every event of every run, old and new", () => {
    for (const { name, events } of everyRun) {
      for (const event of events) {
        expect(mapEventToActions(event)).toEqual(mapEventToActions(event));
        expect(mapEventToActions(event).length, `${name} #${event.sequence} ${event.type}`).toBeGreaterThan(0);
      }
    }
  });
});
