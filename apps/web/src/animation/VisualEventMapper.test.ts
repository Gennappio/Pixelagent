import { describe, expect, it } from "vitest";
import { demoEvents, eventOfType } from "../testing/demoRun";
import { mapEventToActions } from "./VisualEventMapper";

const types = (actions: ReturnType<typeof mapEventToActions>) => actions.map((action) => action.type);

describe("mapEventToActions", () => {
  it("turns MESSAGE_SENT Anna → Luca into move, talk, bubble, return", () => {
    const event = eventOfType("MESSAGE_SENT", "anna");
    const actions = mapEventToActions(event);

    expect(actions.slice(0, 3)).toEqual([
      { type: "MOVE_TO", agentId: "anna", target: { kind: "agent", id: "luca" } },
      { type: "TALK", agentId: "anna" },
      expect.objectContaining({
        type: "SHOW_BUBBLE",
        agentId: "anna",
        text: "Find the latest sales number.",
        eventId: event.id,
      }),
    ]);
    expect(types(actions)).toContain("RETURN_TO_POSITION");
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

  it("is deterministic and handles every event of the demo run", () => {
    for (const event of demoEvents) {
      expect(mapEventToActions(event)).toEqual(mapEventToActions(event));
      expect(mapEventToActions(event).length).toBeGreaterThan(0);
    }
  });
});
