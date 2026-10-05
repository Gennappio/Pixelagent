import { beforeEach, describe, expect, it } from "vitest";
import { demoEvents, demoWorkflow } from "../testing/demoRun";
import { buildLayout } from "../world/layout";
import { replay, seekToPosition } from "./replayStore";

describe("seekToPosition", () => {
  beforeEach(() => replay.load(demoEvents, buildLayout(demoWorkflow)));

  it("puts the playhead just after the n-th event", () => {
    seekToPosition(5);
    expect(replay.getSnapshot().position).toBe(5);
    seekToPosition(0);
    expect(replay.getSnapshot().position).toBe(0);
  });

  it("clamps past either end", () => {
    seekToPosition(demoEvents.length + 50);
    expect(replay.getSnapshot().position).toBe(demoEvents.length);
    seekToPosition(-3);
    expect(replay.getSnapshot().position).toBe(0);
  });

  it("does nothing harmful on an empty log", () => {
    replay.load([], buildLayout(demoWorkflow));
    expect(() => seekToPosition(10)).not.toThrow();
    expect(replay.getSnapshot().position).toBe(0);
  });
});
