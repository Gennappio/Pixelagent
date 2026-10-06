import { beforeEach, describe, expect, it } from "vitest";
import { worldStateAt } from "../animation/EventAnimation";
import { demoEvents, demoWorkflow, parallelEvents, parallelWorkflow } from "../testing/demoRun";
import { buildLayout } from "../world/layout";
import { initialWorldState, STATION_DISTANCE } from "../world/worldState";
import { adjacentSpeed, eventStage, ReplayController, SPEEDS, type ReplaySnapshot } from "./ReplayController";

const layout = buildLayout(demoWorkflow);
const parallelLayout = buildLayout(parallelWorkflow);
const FRAME = 16;

/** Ticks until `ready` says so; fails rather than spin forever. */
function tickUntil(controller: ReplayController, ready: (snapshot: ReplaySnapshot) => boolean, maxFrames = 100_000): void {
  for (let frames = 0; frames < maxFrames; frames++) {
    if (ready(controller.getSnapshot())) return;
    controller.tick(FRAME);
  }
  throw new Error("the controller never got there");
}

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

describe("eventStage", () => {
  const base: ReplaySnapshot = { position: 0, total: 10, playing: false, speed: 1, streaming: false, active: [], finishedAhead: [] };

  it("with nothing in motion, puts the last event applied on show", () => {
    const stopped = { ...base, position: 4 };
    expect([2, 3, 4, 5].map((index) => eventStage(stopped, index))).toEqual(["done", "current", "pending", "pending"]);
    expect(eventStage(base, 0)).toBe("pending");
  });

  it("puts every event in flight on show, however many", () => {
    const busy = { ...base, position: 4, active: [3, 5] };
    expect([2, 3, 4, 5, 6].map((index) => eventStage(busy, index))).toEqual(["done", "current", "pending", "current", "pending"]);
  });

  it("does not call an event still to come when it has already been shown", () => {
    const ahead = { ...base, position: 4, active: [3], finishedAhead: [5] };
    expect([4, 5, 6].map((index) => eventStage(ahead, index))).toEqual(["pending", "done", "pending"]);
  });
});

describe("ReplayController with agents working side by side", () => {
  let controller: ReplayController;

  beforeEach(() => {
    controller = new ReplayController();
    controller.load(parallelEvents, parallelLayout);
  });

  it("reports every event in flight, and keeps the playhead on the first unfinished one", () => {
    controller.play();
    tickUntil(controller, (snapshot) => snapshot.active.length >= 2);
    const { position, active } = controller.getSnapshot();
    expect(active[0]).toBe(position - 1);
    expect(active.every((index) => index >= position - 1)).toBe(true);
    expect(controller.currentEvent).toBe(parallelEvents[position - 1]);
  });

  it("plays to the end and lands on the plain fold of the log", () => {
    controller.play();
    runToStop(controller);
    expect(controller.getSnapshot()).toMatchObject({ position: parallelEvents.length, playing: false, active: [], finishedAhead: [] });
    expect(controller.worldState).toEqual(worldStateAt(parallelEvents, parallelEvents.length, parallelLayout));
  });

  it("freezes everything in flight while paused, and carries on from there", () => {
    controller.play();
    tickUntil(controller, (snapshot) => snapshot.active.length >= 2);
    controller.pause();
    const frozen = controller.worldState;
    const { active, position } = controller.getSnapshot();
    for (let i = 0; i < 100; i++) controller.tick(FRAME);
    expect(controller.worldState).toEqual(frozen);
    expect(controller.getSnapshot()).toMatchObject({ active, position, playing: false });

    controller.play();
    runToStop(controller);
    expect(controller.worldState).toEqual(worldStateAt(parallelEvents, parallelEvents.length, parallelLayout));
  });

  it("goes back to one event at a time when stepping out of concurrent play", () => {
    controller.play();
    tickUntil(controller, (snapshot) => snapshot.active.length >= 2);
    const playhead = controller.getSnapshot().position; // the event animating at the playhead

    controller.next();
    // That event is finished, what ran ahead is taken back, and the next one alone is animating.
    expect(controller.getSnapshot()).toMatchObject({ position: playhead + 1, active: [playhead], finishedAhead: [], playing: true });
    runToStop(controller);
    expect(controller.getSnapshot()).toMatchObject({ position: playhead + 1, active: [], playing: false });
    expect(controller.worldState).toEqual(worldStateAt(parallelEvents, playhead + 1, parallelLayout));
  });

  it("steps through the whole run showing exactly one more event each time", () => {
    for (let count = 1; count <= parallelEvents.length; count++) {
      controller.next();
      expect(controller.getSnapshot().active.length).toBeLessThanOrEqual(1);
      runToStop(controller);
      expect(controller.getSnapshot().position).toBe(count);
      expect(controller.worldState).toEqual(worldStateAt(parallelEvents, count, parallelLayout));
    }
    controller.next();
    expect(controller.getSnapshot()).toMatchObject({ position: parallelEvents.length, playing: false });
  });

  it("previous() from concurrent play lands on the state before the event at the playhead", () => {
    controller.play();
    tickUntil(controller, (snapshot) => snapshot.active.length >= 2);
    const playhead = controller.getSnapshot().position;
    controller.previous();
    expect(controller.getSnapshot()).toMatchObject({ position: playhead - 1, active: [], playing: false });
    expect(controller.worldState).toEqual(worldStateAt(parallelEvents, playhead - 1, parallelLayout));
  });

  it("tells its listeners when something they can see changes, not on every frame", () => {
    let notified = 0;
    controller.subscribe(() => (notified += 1));
    controller.play();
    const frames = runToStop(controller);
    expect(frames).toBeGreaterThan(1000);
    // A handful per event (it starts, it ends, the playhead moves), nowhere near one per frame.
    expect(notified).toBeGreaterThan(parallelEvents.length);
    expect(notified).toBeLessThan(parallelEvents.length * 6);
  });

  it("replaces its snapshot exactly when it notifies, never silently and never for nothing", () => {
    let notified = 0;
    let replaced = 0;
    controller.subscribe(() => (notified += 1));
    controller.play();
    let previous = controller.getSnapshot();
    while (controller.getSnapshot().playing) {
      controller.tick(FRAME);
      const current = controller.getSnapshot();
      if (current !== previous) {
        replaced += 1;
        expect(current).not.toEqual(previous);
      }
      previous = current;
    }
    // play() itself notified once before the loop began watching.
    expect(replaced).toBe(notified - 1);
    expect(replaced).toBeGreaterThan(parallelEvents.length);
  });
});

describe("where the camera should look", () => {
  let controller: ReplayController;

  beforeEach(() => {
    controller = new ReplayController();
    controller.load(demoEvents, layout);
  });

  it("is nowhere in particular during continuous play", () => {
    controller.play();
    for (let i = 0; i < 300; i++) {
      controller.tick(FRAME);
      expect(controller.focus).toBeUndefined();
    }
  });

  it("is the agent of the event being stepped, and moves with it", () => {
    controller.seek(3);
    controller.next(); // event 4: Anna walks over to Luca
    const before = controller.focus!;
    expect(before.key).toBe(demoEvents[3].id);
    expect(before.position).toEqual(layout.homes.anna);
    for (let i = 0; i < 20; i++) controller.tick(FRAME);
    expect(controller.focus!.key).toBe(before.key);
    expect(controller.focus!.position.x).toBeGreaterThan(before.position.x);
  });

  it("is the agent of the event at the playhead when stopped there", () => {
    controller.seek(9); // Luca at the computer
    expect(controller.focus).toEqual({ key: demoEvents[8].id, position: controller.worldState.agents.luca.position });
    expect(controller.focus!.position).not.toEqual(layout.homes.luca);
  });

  it("is nowhere for an event that belongs to no agent, and before the run starts", () => {
    expect(controller.focus).toBeUndefined();
    controller.seek(1); // RUN_STARTED
    expect(controller.focus).toBeUndefined();
  });
});

