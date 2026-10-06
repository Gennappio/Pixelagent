import { describe, expect, it } from "vitest";
import type { Workflow } from "../protocol/workflow";
import { demoWorkflow, parallelWorkflow, tablesWorkflow } from "../testing/demoRun";
import { buildLayout, EMPTY_LAYOUT, ROOM } from "./layout";

describe("buildLayout", () => {
  const layout = buildLayout(demoWorkflow);

  it("stands the in-tray by the entry agent and the out-tray by the exit agent, inside the room", () => {
    expect(layout.trays.in!.x).toBeLessThan(layout.homes.anna.x);
    expect(layout.trays.out!.x).toBeGreaterThan(layout.homes.gianni.x);
    for (const tray of [layout.trays.in!, layout.trays.out!]) {
      expect(tray.x).toBeGreaterThan(0);
      expect(tray.x).toBeLessThan(ROOM.width);
      expect(Math.abs(tray.y - layout.homes.anna.y)).toBeLessThan(20);
    }
  });

  it("puts both trays by the same agent when it is both entry and exit", () => {
    const solo: Workflow = {
      ...demoWorkflow,
      agents: demoWorkflow.agents.slice(0, 1),
      relations: [
        { id: "r1", subject: "anna", verb: "is_entry" },
        { id: "r2", subject: "anna", verb: "is_exit" },
      ],
    };
    const { trays, homes } = buildLayout(solo);
    expect(trays.in!.x).toBeLessThan(homes.anna.x);
    expect(trays.out!.x).toBeGreaterThan(homes.anna.x);
  });

  it("has no trays when the workflow does not say where the task enters or leaves", () => {
    expect(buildLayout({ ...demoWorkflow, relations: [] }).trays).toEqual({});
  });

  it("gives a station to each tool some agent can use, and to no other", () => {
    expect(layout.tools).toEqual(["web_search", "send_email"]);
    expect(Object.keys(layout.stations)).toEqual(["web_search", "send_email"]);
    expect(buildLayout({ ...demoWorkflow, relations: [] }).tools).toEqual([]);
    const shared: Workflow = { ...demoWorkflow, relations: [...demoWorkflow.relations, { id: "r9", subject: "anna", verb: "uses_tool", object: "web_search" }] };
    expect(buildLayout(shared).tools).toEqual(["web_search", "send_email"]); // one station, two users
  });

  it("has no tables for the demo", () => {
    expect(layout.tables).toEqual([]);
  });

  it("places each table in the room and moves the agents back to make room", () => {
    const office = buildLayout(tablesWorkflow);
    expect(office.tables).toEqual([
      { id: "todo", name: "To research", mode: "pile" },
      { id: "done", name: "Researched", mode: "pile" },
      { id: "board", name: "Board", mode: "shared" },
    ]);
    const xs = office.tables.map((table) => office.tablePositions[table.id].x);
    expect(new Set(xs).size).toBe(3);
    for (const table of office.tables) {
      const position = office.tablePositions[table.id];
      expect(position.x).toBeGreaterThan(0);
      expect(position.x).toBeLessThan(ROOM.width);
      expect(position.y).toBeLessThan(ROOM.height);
      expect(position.y).toBeGreaterThan(Math.max(...Object.values(office.homes).map((home) => home.y)) + 30);
    }
    expect(office.homes.anna.y).toBeLessThan(layout.homes.anna.y);
  });

  it("keeps every agent of a larger office inside the room, no two in the same spot", () => {
    for (const workflow of [tablesWorkflow, parallelWorkflow]) {
      const homes = Object.values(buildLayout(workflow).homes);
      expect(new Set(homes.map((home) => `${home.x},${home.y}`)).size).toBe(homes.length);
      for (const home of homes) {
        expect(home.x).toBeGreaterThan(0);
        expect(home.x).toBeLessThan(ROOM.width);
      }
    }
  });

  it("is the same every time for the same workflow", () => {
    expect(buildLayout(tablesWorkflow)).toEqual(buildLayout(tablesWorkflow));
    expect(EMPTY_LAYOUT.tables).toEqual([]);
  });
});
