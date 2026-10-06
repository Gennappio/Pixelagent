import { describe, expect, it } from "vitest";
import { ICONS, sizeOf } from "../pixel/bitmaps";
import { statusIcon } from "./statusIcon";
import type { AgentVisualState } from "./worldState";

const agent = (status: AgentVisualState["status"], alert = false, bubble = false) => ({
  status,
  alert,
  speechBubble: bubble ? { text: "Go ahead.", kind: "speech" as const, eventId: "evt_1" } : undefined,
});

describe("statusIcon", () => {
  it("shows what a character is doing, and nothing while it stands idle", () => {
    expect(statusIcon(agent("idle"))).toBeNull();
    expect(statusIcon(agent("thinking"))).toBe("thinking");
    expect(statusIcon(agent("waiting"))).toBe("waiting");
    expect(statusIcon(agent("working"))).toBe("working");
  });

  it("shows an error before anything else", () => {
    for (const status of ["idle", "thinking", "waiting", "working"] as const) expect(statusIcon(agent(status, true)), status).toBe("error");
  });

  it("gives way to a speech bubble, which takes the same spot", () => {
    expect(statusIcon(agent("thinking", false, true))).toBeNull();
    expect(statusIcon(agent("idle", true, true))).toBeNull();
  });

  it("has a small picture for every icon it can answer with", () => {
    for (const name of ["thinking", "waiting", "working", "error"] as const) expect(sizeOf(ICONS[name]), name).toEqual({ width: 7, height: 7 });
  });
});
