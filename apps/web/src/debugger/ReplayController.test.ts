import { beforeEach, describe, expect, it } from "vitest";
import { worldStateAt } from "../animation/AnimationController";
import { demoEvents, demoWorkflow } from "../testing/demoRun";
import { buildLayout } from "../world/layout";
import { initialWorldState, STATION_DISTANCE } from "../world/worldState";
import { adjacentSpeed, ReplayController, SPEEDS } from "./ReplayController";

const layout = buildLayout(demoWorkflow);
const FRAME = 16;

/** Runs frames until the controller stops playing (or a frame budget runs out). */
function runToStop(controller: ReplayController, maxFrames = 100_000): number {
  let frames = 0;
  while (controller.getSnapshot().playing && frames < maxFrames) {
    controller.tick(FRAME);
    frames += 1;
  }
  return frames;
}

describe("adjacentSpeed", () => {
  it("steps through the supported speeds and stops at both ends", () => {
    expect(adjacentSpeed(1, 1)).toBe(2);
    expect(adjacentSpeed(1, -1)).toBe(0.5);
    expect(adjacentSpeed(4, 1)).toBe(4);
    expect(adjacentSpeed(0.25, -1)).toBe(0.25);
    for (const speed of SPEEDS) expect(SPEEDS).toContain(adjacentSpeed(speed, 1));
  });

  it("recovers from a speed that is not in the list", () => {
    expect(SPEEDS).toContain(adjacentSpeed(3, 1));
    expect(SPEEDS).toContain(adjacentSpeed(100, -1));
  });
});

describe("ReplayController", () => {
  let controller: ReplayController;

  beforeEach(() => {
    controller = new ReplayController();
    controller.load(demoEvents, layout);
  });

  it("starts paused at the beginning with everyone at home", () => {
    expect(controller.getSnapshot()).toMatchObject({ position: 0, total: demoEvents.length, playing: false });
    expect(controller.worldState).toEqual(initialWorldState(layout));
  });

  it("plays the whole log and stops at the end", () => {
    controller.play();
    runToStop(controller);
    expect(controller.getSnapshot()).toMatchObject({ position: demoEvents.length, playing: false });
    expect(controller.worldState).toEqual(worldStateAt(demoEvents, demoEvents.length, layout));
  });

  it("ends in the same state at every speed, in less time when faster", () => {
    const framesAt = (speed: number) => {
      const c = new ReplayController();
      c.load(demoEvents, layout);
      c.setSpeed(speed);
      c.play();
      const frames = runToStop(c);
      expect(c.worldState).toEqual(worldStateAt(demoEvents, demoEvents.length, layout));
      return frames;
    };
    expect(framesAt(4)).toBeLessThan(framesAt(1));
    expect(framesAt(1)).toBeLessThan(framesAt(0.25));
  });

  it("replays identically every time (same run, same observable execution)", () => {
    const record = () => {
      const frames: string[] = [];
      controller.play();
      while (controller.getSnapshot().playing) {
        controller.tick(FRAME);
        frames.push(JSON.stringify(controller.worldState));
      }
      return frames;
    };
    const first = record();
    const second = record(); // play() at the end restarts from scratch
    expect(second).toEqual(first);
  });

  it("does not advance while paused", () => {
    controller.play();
    for (let i = 0; i < 50; i++) controller.tick(FRAME);
    controller.pause();
    const frozen = controller.worldState;
    const { position } = controller.getSnapshot();
    for (let i = 0; i < 50; i++) controller.tick(FRAME);
    expect(controller.worldState).toEqual(frozen);
    expect(controller.getSnapshot().position).toBe(position);
  });

  it("next() animates exactly one event and stops", () => {
    controller.next();
    expect(controller.getSnapshot()).toMatchObject({ position: 1, playing: true });
    runToStop(controller);
    expect(controller.getSnapshot()).toMatchObject({ position: 1, playing: false });
    expect(controller.currentEvent).toBe(demoEvents[0]);

    controller.next();
    controller.next(); // pressing again mid-animation skips ahead rather than queueing
    runToStop(controller);
    expect(controller.getSnapshot().position).toBe(3);
    expect(controller.worldState).toEqual(worldStateAt(demoEvents, 3, layout));
  });

  it("previous() steps back by rebuilding state from the log", () => {
    controller.seek(10);
    controller.previous();
    expect(controller.getSnapshot()).toMatchObject({ position: 9, playing: false });
    expect(controller.worldState).toEqual(worldStateAt(demoEvents, 9, layout));
    controller.seek(0);
    controller.previous();
    expect(controller.getSnapshot().position).toBe(0);
  });

  it("seek() lands on the state right after that sequence", () => {
    controller.seek(9); // TOOL_CALL: Luca is at the computer
    const luca = controller.worldState.agents.luca;
    expect(luca.animation).toBe("working");
    expect(luca.position).toEqual({ x: layout.stations.web_search.x, y: layout.stations.web_search.y + STATION_DISTANCE });
    expect(controller.worldState.stations.web_search).toMatchObject({ active: true, userId: "luca" });

    controller.seek(13);
    expect(controller.worldState.agents.luca.position).toEqual(layout.homes.luca);
    expect(controller.worldState.stations.web_search.active).toBe(false);
  });

  it("seeking is independent of how the playhead got there", () => {
    controller.play();
    for (let i = 0; i < 400; i++) controller.tick(FRAME);
    controller.seek(12);
    expect(controller.worldState).toEqual(worldStateAt(demoEvents, 12, layout));
  });

  it("orders events by sequence, not by arrival or timestamp", () => {
    controller.load([...demoEvents].reverse(), layout);
    expect(controller.log.map((event) => event.sequence)).toEqual(demoEvents.map((event) => event.sequence));
  });

  describe("live mode", () => {
    beforeEach(() => {
      controller.load([], layout, { streaming: true });
      controller.play();
    });

    it("buffers events that arrive faster than they can be animated", () => {
      demoEvents.forEach((event) => controller.append(event));
      controller.tick(FRAME);
      expect(controller.getSnapshot()).toMatchObject({ position: 1, total: demoEvents.length, playing: true });
    });

    it("waits for more events while streaming and stops once the stream ends", () => {
      controller.append(demoEvents[0]);
      for (let i = 0; i < 200; i++) controller.tick(FRAME);
      expect(controller.getSnapshot()).toMatchObject({ position: 1, playing: true });

      demoEvents.slice(1).forEach((event) => controller.append(event));
      controller.setStreaming(false);
      runToStop(controller);
      expect(controller.getSnapshot()).toMatchObject({ position: demoEvents.length, playing: false });
    });

    it("ends in the same world as a replay of the stored log", () => {
      demoEvents.forEach((event) => controller.append(event));
      controller.append(demoEvents[3]); // a duplicate delivery is ignored
      controller.setStreaming(false);
      runToStop(controller);

      const replay = new ReplayController();
      replay.load(demoEvents, layout);
      replay.play();
      runToStop(replay);
      expect(controller.worldState).toEqual(replay.worldState);
      expect(controller.log).toEqual(replay.log);
    });
  });
});
