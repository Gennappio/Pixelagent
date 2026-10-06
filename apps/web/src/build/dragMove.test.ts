import { describe, expect, it } from "vitest";
import type { Workflow } from "../protocol/workflow";
import { demoWorkflow, parallelWorkflow, tablesWorkflow } from "../testing/demoRun";
import { BOUNDS, buildLayout } from "../world/layout";

import { moveThing, pinLayout, positionKey } from "./dragMove";

describe("positionKey", () => {
  it("names the place of a character, a table and a station that are in the office", () => {
    expect(positionKey(tablesWorkflow, { kind: "agent", id: "luca" })).toBe("luca");
    expect(positionKey(tablesWorkflow, { kind: "table", id: "board" })).toBe("table:board");
    expect(positionKey(tablesWorkflow, { kind: "station", id: "web_search" })).toBe("station:web_search@office");
  });

  it("has no place for what the office does not have", () => {
    expect(positionKey(demoWorkflow, { kind: "agent", id: "nobody" })).toBeUndefined();
    expect(positionKey(demoWorkflow, { kind: "table", id: "board" })).toBeUndefined();
    // A tool nobody uses has no station to move.
    expect(positionKey(demoWorkflow, { kind: "station", id: "calculator" })).toBeUndefined();
  });
});

describe("pinLayout", () => {
  it("writes down where everything stands, and moves nothing", () => {
    for (const workflow of [demoWorkflow, tablesWorkflow, parallelWorkflow]) {
      const pinned = pinLayout(workflow);
      expect(buildLayout(pinned)).toEqual(buildLayout(workflow));
      const layout = buildLayout(workflow);
      const things = Object.keys(layout.homes).length + Object.keys(layout.tablePositions).length + Object.keys(layout.stations).length;
      expect(Object.keys(pinned.layout.positions)).toHaveLength(things);
      // Only the layout is touched.
      expect({ ...pinned, layout: workflow.layout }).toEqual(workflow);
    }
    expect(pinLayout(demoWorkflow).layout.positions).toEqual({
      anna: { x: 170, y: 280 },
      luca: { x: 320, y: 280 },
      gianni: { x: 470, y: 280 },
      "station:web_search@office": { x: 233, y: 100 },
      "station:send_email@office": { x: 407, y: 100 },
    });
  });

  it("has nothing more to do the second time", () => {
    const pinned = pinLayout(tablesWorkflow);
    expect(pinLayout(pinned)).toBe(pinned);
  });

  it("is what keeps the others still when one more arrives", () => {
    const more = (workflow: Workflow): Workflow => ({ ...workflow, agents: [...workflow.agents, { ...workflow.agents[0], id: "marta", name: "Marta" }] });
    // Spread over the room by how many they are, three become four and everybody shifts…
    expect(buildLayout(more(demoWorkflow)).homes.anna).not.toEqual(buildLayout(demoWorkflow).homes.anna);
    // …unless where they stood was written down first.
    const layout = buildLayout(more(pinLayout(demoWorkflow)));
    for (const id of ["anna", "luca", "gianni"]) expect(layout.homes[id]).toEqual(buildLayout(demoWorkflow).homes[id]);
  });
});

describe("moveThing", () => {
  it("stands a thing somewhere else and leaves everything else where it was", () => {
    const before = buildLayout(demoWorkflow);
    const moved = moveThing(demoWorkflow, { kind: "agent", id: "luca" }, { x: 100.4, y: 199.7 });
    const after = buildLayout(moved);
    expect(after.homes.luca).toEqual({ x: 100, y: 200 });
    expect(after.homes.anna).toEqual(before.homes.anna);
    expect(after.homes.gianni).toEqual(before.homes.gianni);
    expect(after.stations).toEqual(before.stations);
    expect(demoWorkflow.layout.positions).toEqual({}); // the workflow it was given is not changed
  });

  it("moves tables and stations too", () => {
    const table = moveThing(tablesWorkflow, { kind: "table", id: "board" }, { x: 200, y: 300 });
    expect(buildLayout(table).tablePositions.board).toEqual({ x: 200, y: 300 });
    const station = moveThing(demoWorkflow, { kind: "station", id: "send_email" }, { x: 520, y: 180 });
    expect(buildLayout(station).stations.send_email).toEqual({ x: 520, y: 180 });
    expect(buildLayout(station).stations.web_search).toEqual(buildLayout(demoWorkflow).stations.web_search);
  });

  it("changes the layout and nothing else: dragging never connects", () => {
    const moved = moveThing(moveThing(tablesWorkflow, { kind: "agent", id: "luca" }, { x: 60, y: 300 }), { kind: "table", id: "todo" }, { x: 500, y: 200 });
    expect({ ...moved, layout: tablesWorkflow.layout }).toEqual(tablesWorkflow);
    expect(moved.relations).toBe(tablesWorkflow.relations);
  });

  it("writes everybody's place down, so that nobody shifts afterwards", () => {
    const usual = buildLayout(demoWorkflow).homes;
    // Luca is dropped exactly where Anna stands: she is not pushed aside to make room…
    const onTop = moveThing(demoWorkflow, { kind: "agent", id: "luca" }, usual.anna);
    expect(buildLayout(onTop).homes.anna).toEqual(usual.anna);
    expect(buildLayout(onTop).homes.luca).toEqual(usual.anna);
    // …and when a fourth arrives later, with no place of its own, the three stay where they were.
    const moved = moveThing(demoWorkflow, { kind: "agent", id: "anna" }, { x: 100, y: 330 });
    const more: Workflow = { ...moved, agents: [...moved.agents, { ...moved.agents[0], id: "marta", name: "Marta" }] };
    expect(buildLayout(more).homes.luca).toEqual(usual.luca);
    expect(buildLayout(more).homes.gianni).toEqual(usual.gianni);
    expect(buildLayout(more).homes.anna).toEqual({ x: 100, y: 330 });
  });

  it("keeps what is dragged inside the room", () => {
    const dragged = moveThing(demoWorkflow, { kind: "agent", id: "anna" }, { x: 99_999.4, y: -99_999 });
    // What is saved is already a place in the room, on whole pixels: the file needs no tidying when it is read.
    expect(dragged.layout.positions.anna).toEqual({ x: BOUNDS.agent.maxX, y: BOUNDS.agent.minY });
    const far = buildLayout(dragged).homes.anna;
    expect(far).toEqual({ x: BOUNDS.agent.maxX, y: BOUNDS.agent.minY });
    const station = buildLayout(moveThing(demoWorkflow, { kind: "station", id: "web_search" }, { x: 320, y: 9_999 })).stations.web_search;
    expect(station.y).toBe(BOUNDS.station.maxY);
  });

  it("does nothing for what the office does not have", () => {
    expect(moveThing(demoWorkflow, { kind: "agent", id: "nobody" }, { x: 1, y: 1 })).toBe(demoWorkflow);
    expect(moveThing(demoWorkflow, { kind: "station", id: "calculator" }, { x: 1, y: 1 })).toBe(demoWorkflow);
  });

  it("put down where it already was, moves nothing", () => {
    const pinned = pinLayout(demoWorkflow);
    expect(moveThing(pinned, { kind: "agent", id: "luca" }, { x: 320, y: 280 })).toBe(pinned);
  });
});
