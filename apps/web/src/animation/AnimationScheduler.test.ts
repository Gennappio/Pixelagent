import { describe, expect, it } from "vitest";
import type { AgentEvent } from "../protocol/events";
import { demoEvents, demoWorkflow, parallelEvents, parallelWorkflow, tablesEvents, tablesWorkflow } from "../testing/demoRun";
import { buildLayout, type WorldLayout } from "../world/layout";
import type { WorldState } from "../world/worldState";
import { AnimationScheduler, LOOKAHEAD } from "./AnimationScheduler";
import { worldStateAt } from "./EventAnimation";

const demoLayout = buildLayout(demoWorkflow);
const parallelLayout = buildLayout(parallelWorkflow);
const RUNS = [
  ["the demo", demoEvents, demoLayout],
  ["the run with tables", tablesEvents, buildLayout(tablesWorkflow)],
  ["the run with two agents at once", parallelEvents, parallelLayout],
] as const;

interface Frame {
  settled: number;
  active: number[];
  ahead: number[];
  state: WorldState;
}

interface Trace {
  frames: Frame[];
  /** Frame at which each event was first seen started, and first seen finished. */
  start: number[];
  end: number[];
}

/** Plays a whole log through a scheduler and records what it showed at every frame. */
function play(events: readonly AgentEvent[], layout: WorldLayout, window: number, frameMs = 16): Trace {
  const scheduler = new AnimationScheduler();
  scheduler.load(events, layout);
  const frames: Frame[] = [];
  const start: number[] = [];
  const end: number[] = [];
  while ((scheduler.settled < events.length || scheduler.busy) && frames.length < 200_000) {
    scheduler.advance(frameMs, window);
    const frame = { settled: scheduler.settled, active: scheduler.active, ahead: scheduler.finishedAhead, state: scheduler.state };
    const at = frames.push(frame) - 1;
    events.forEach((_, index) => {
      const finished = index < frame.settled || frame.ahead.includes(index);
      if (start[index] === undefined && (finished || frame.active.includes(index))) start[index] = at;
      if (end[index] === undefined && finished) end[index] = at;
    });
  }
  expect(scheduler.settled, "the run should play to its end").toBe(events.length);
  return { frames, start, end };
}

const indexOf = (events: readonly AgentEvent[], sequence: number) => events.findIndex((event) => event.sequence === sequence);

describe("the settled world does not depend on lanes", () => {
  it.each(RUNS)("%s ends in the plain fold of its log, however many events may overlap", (_name, events, layout) => {
    const expected = worldStateAt(events, events.length, layout);
    for (const window of [1, 2, 3, LOOKAHEAD, 50]) {
      expect(play(events, layout, window).frames.at(-1)!.state, `window ${window}`).toEqual(expected);
    }
  });

  it.each(RUNS)("%s shows the fold of the settled prefix whenever nothing is in motion", (_name, events, layout) => {
    let quiet = 0;
    for (const frame of play(events, layout, LOOKAHEAD).frames) {
      if (frame.active.length > 0 || frame.ahead.length > 0) continue;
      quiet += 1;
      expect(frame.state).toEqual(worldStateAt(events, frame.settled, layout));
    }
    expect(quiet).toBeGreaterThan(0);
  });

  it("ends the same whatever the frame rate", () => {
    const expected = worldStateAt(parallelEvents, parallelEvents.length, parallelLayout);
    for (const frameMs of [4, 16, 33, 250]) {
      expect(play(parallelEvents, parallelLayout, LOOKAHEAD, frameMs).frames.at(-1)!.state, `${frameMs} ms frames`).toEqual(expected);
    }
  });

  it("shows the same frames every time", () => {
    const frames = () => play(parallelEvents, parallelLayout, LOOKAHEAD).frames.map((frame) => JSON.stringify(frame));
    expect(frames()).toEqual(frames());
  });

  it("drops everything in flight on a jump and shows exactly that prefix", () => {
    const scheduler = new AnimationScheduler();
    scheduler.load(parallelEvents, parallelLayout);
    for (let i = 0; i < 900; i++) scheduler.advance(16, LOOKAHEAD);
    expect(scheduler.busy).toBe(true);
    for (const count of [0, 5, 13, parallelEvents.length]) {
      scheduler.jumpTo(count);
      expect(scheduler.busy).toBe(false);
      expect(scheduler.settled).toBe(count);
      expect(scheduler.state).toEqual(worldStateAt(parallelEvents, count, parallelLayout));
    }
  });
});

describe("events on different lanes animate together", () => {
  const trace = play(parallelEvents, parallelLayout, LOOKAHEAD);
  const lucaCall = indexOf(parallelEvents, 14);
  const gianniCall = indexOf(parallelEvents, 15);

  it("has Luca and Gianni at their tools at the same time", () => {
    // Not in lockstep: Anna briefs Luca first, so he is a little ahead. But their tool calls
    // overlap, and for a good while both are away from their desks, each at a busy station.
    const together = trace.frames.filter((frame) => frame.active.includes(lucaCall) && frame.active.includes(gianniCall));
    expect(together.length).toBeGreaterThan(10);
    const bothBusy = trace.frames.filter((frame) => frame.state.stations.web_search.active && frame.state.stations.send_email.active);
    expect(bothBusy.length).toBeGreaterThan(30);
    for (const frame of bothBusy) {
      expect(frame.state.stations.web_search.userId).toBe("luca");
      expect(frame.state.stations.send_email.userId).toBe("gianni");
      expect(frame.state.agents.luca.position).not.toEqual(parallelLayout.homes.luca);
      expect(frame.state.agents.gianni.position).not.toEqual(parallelLayout.homes.gianni);
    }
    // Shown one event at a time, the two calls are never animated together. (Both stations
    // still end up busy at once: Gianni's call comes before Luca's result in the log itself.)
    const oneByOne = play(parallelEvents, parallelLayout, 1).frames;
    expect(oneByOne.some((frame) => frame.active.includes(lucaCall) && frame.active.includes(gianniCall))).toBe(false);
    expect(oneByOne.some((frame) => frame.state.stations.web_search.active && frame.state.stations.send_email.active)).toBe(true);
  });

  it("takes less time than showing the same events one by one", () => {
    const oneByOne = play(parallelEvents, parallelLayout, 1);
    expect(trace.frames.length).toBeLessThan(oneByOne.frames.length * 0.85);
  });

  it("never lets an agent do two things at once", () => {
    for (const [name, events, layout] of RUNS) {
      const { start, end } = play(events, layout, LOOKAHEAD);
      events.forEach((later, j) => {
        events.slice(0, j).forEach((earlier, i) => {
          if (!later.actorId || later.actorId !== earlier.actorId) return;
          expect(start[j], `${name}: #${later.sequence} began before #${earlier.sequence} was over`).toBeGreaterThanOrEqual(end[i]);
        });
      });
    }
  });

  it("lets a recipient react as soon as it is handed the sheet, while the sender walks back", () => {
    const { frames, start } = play(demoEvents, demoLayout, LOOKAHEAD);
    const sent = indexOf(demoEvents, 4); // Anna → Luca
    const received = indexOf(demoEvents, 6); // Luca receives
    const moment = frames[start[received]];
    expect(moment.active).toContain(sent);
    expect(moment.state.documents.doc_1).toEqual({ documentId: "doc_1", title: "Message to Luca", version: 1, place: { kind: "hand", agentId: "luca" } });
    expect(moment.state.agents.anna.position).not.toEqual(demoLayout.homes.anna);
    expect(moment.state.agents.anna.animation).toBe("walk");
  });

  it("makes the second reporter wait until Marta has taken the first report", () => {
    const first = indexOf(parallelEvents, 20); // Luca → Marta
    const second = indexOf(parallelEvents, 22); // Gianni → Marta
    expect([parallelEvents[first].targetId, parallelEvents[second].targetId]).toEqual(["marta", "marta"]);
    const moment = trace.frames[trace.start[second]];
    expect(moment.state.documents.doc_3.place).toEqual({ kind: "hand", agentId: "marta" });
    expect(moment.state.documents.doc_3.transit).toBeUndefined();
    expect(trace.start[second]).toBeGreaterThan(trace.start[first]);
    // ...and nobody talks over anybody.
    for (const frame of trace.frames) {
      const talking = ["luca", "gianni"].filter((id) => frame.state.agents[id].speechBubble?.kind === "speech");
      expect(talking.length).toBeLessThanOrEqual(1);
    }
  });

  it("shows an event that finished ahead of the playhead as finished, not as still to come", () => {
    const ranAhead = trace.frames.filter((frame) => frame.ahead.length > 0);
    expect(ranAhead.length).toBeGreaterThan(0);
    for (const frame of ranAhead) {
      for (const index of frame.ahead) expect(index).toBeGreaterThan(frame.settled);
    }
  });

  it("does not show the run finishing while someone it does not involve is still moving", () => {
    // Luca is on his way to a tool when the log says the run is over, with Marta's result.
    // Nothing ties the two together but the run itself, which is the point.
    const log = [parallelEvents[0], parallelEvents[indexOf(parallelEvents, 14)], parallelEvents.at(-1)!].map((event, index) => ({
      ...event,
      sequence: index + 1,
    }));
    expect(log.map((event) => [event.type, event.actorId ?? event.payload.authorId])).toEqual([
      ["RUN_STARTED", undefined],
      ["TOOL_CALL", "luca"],
      ["RUN_FINISHED", "marta"],
    ]);
    const { frames, start, end } = play(log, parallelLayout, LOOKAHEAD);
    expect(start[2]).toBeGreaterThanOrEqual(end[1]);
    for (const frame of frames) {
      if (frame.active.includes(2)) expect(frame.active).toEqual([2]);
    }
  });

  it("holds the whole office still while the run starts and while it finishes", () => {
    for (const [, events, layout] of RUNS) {
      const { frames } = play(events, layout, LOOKAHEAD);
      const last = events.length - 1;
      for (const frame of frames) {
        if (frame.active.includes(0)) expect(frame.active).toEqual([0]);
        if (frame.active.includes(last)) expect(frame.active).toEqual([last]);
      }
    }
  });
});

describe("the lookahead window", () => {
  it.each(RUNS)("at 1 shows %s strictly one event at a time, in log order", (_name, events, layout) => {
    const { frames, start, end } = play(events, layout, 1);
    for (const frame of frames) {
      expect(frame.active.length).toBeLessThanOrEqual(1);
      expect(frame.ahead).toEqual([]);
    }
    for (let index = 1; index < events.length; index++) expect(start[index]).toBeGreaterThanOrEqual(end[index - 1]);
  });

  it("never lets an event start more than a window past the playhead", () => {
    for (const window of [2, 3, LOOKAHEAD]) {
      let widest = 0;
      for (const frame of play(parallelEvents, parallelLayout, window).frames) {
        const started = [...frame.active, ...frame.ahead];
        for (const index of started) expect(index).toBeLessThan(frame.settled + window);
        widest = Math.max(widest, frame.active.length);
      }
      expect(widest).toBeGreaterThan(1);
    }
  });
});

describe("stepping and live logs", () => {
  it("launch(1) starts only the event at the playhead", () => {
    const scheduler = new AnimationScheduler();
    scheduler.load(parallelEvents, parallelLayout);
    // The playhead on Luca's tool call, with Gianni's right behind it.
    scheduler.jumpTo(indexOf(parallelEvents, 14));
    scheduler.launch(1);
    expect(scheduler.active).toEqual([indexOf(parallelEvents, 14)]);
    scheduler.launch(LOOKAHEAD);
    expect(scheduler.active).toEqual([indexOf(parallelEvents, 14), indexOf(parallelEvents, 15)]);
  });

  it("settleFront finishes the event at the playhead and takes back what ran ahead", () => {
    const scheduler = new AnimationScheduler();
    scheduler.load(parallelEvents, parallelLayout);
    scheduler.jumpTo(indexOf(parallelEvents, 14));
    for (let i = 0; i < 20; i++) scheduler.advance(16, LOOKAHEAD);
    expect(scheduler.active.length).toBeGreaterThan(1);
    const playhead = scheduler.settled;

    scheduler.settleFront();
    expect(scheduler.busy).toBe(false);
    expect(scheduler.settled).toBe(playhead + 1);
    expect(scheduler.state).toEqual(worldStateAt(parallelEvents, playhead + 1, parallelLayout));

    scheduler.settleFront(); // nothing in flight: nothing to do
    expect(scheduler.settled).toBe(playhead + 1);
  });

  it("gets through events that have nothing to show", () => {
    const silent = demoEvents.map((event) => ({ ...event, actorId: undefined, type: "DECISION" as const }));
    const { frames } = play(silent, demoLayout, LOOKAHEAD);
    expect(frames.length).toBeLessThanOrEqual(silent.length);
  });

  it("picks up events appended to the log it was given", () => {
    const log: AgentEvent[] = demoEvents.slice(0, 3);
    const scheduler = new AnimationScheduler();
    scheduler.load(log, demoLayout);
    for (let i = 0; i < 2000 && (scheduler.settled < log.length || scheduler.busy); i++) scheduler.advance(16, LOOKAHEAD);
    expect(scheduler.settled).toBe(3);

    log.push(...demoEvents.slice(3));
    for (let i = 0; i < 20_000 && (scheduler.settled < log.length || scheduler.busy); i++) scheduler.advance(16, LOOKAHEAD);
    expect(scheduler.settled).toBe(demoEvents.length);
    expect(scheduler.state).toEqual(worldStateAt(demoEvents, demoEvents.length, demoLayout));
  });
});
