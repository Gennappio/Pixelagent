import { describe, expect, it } from "vitest";
import type { Workflow } from "../protocol/workflow";
import { demoWorkflow, parallelWorkflow, tablesWorkflow } from "../testing/demoRun";
import { agentKey, BOUNDS, buildLayout, clampToRoom, EMPTY_LAYOUT, freeSpot, ROOM, stationKey, tableKey } from "./layout";

/** The same workflow with some things standing where they were put by hand. */
const placed = (workflow: Workflow, positions: Workflow["layout"]["positions"]): Workflow => ({ ...workflow, layout: { positions } });

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

describe("where things were put by hand", () => {
  it("names each thing's place by a key of its own", () => {
    expect([agentKey("luca"), tableKey("board"), stationKey("web_search", "office")]).toEqual(["luca", "table:board", "station:web_search@office"]);
  });

  it("stands a character, a table and a station where the workflow says", () => {
    const office = buildLayout(placed(tablesWorkflow, { luca: { x: 100, y: 200 }, "table:board": { x: 300, y: 330 }, "station:web_search@office": { x: 500, y: 150 } }));
    expect(office.homes.luca).toEqual({ x: 100, y: 200 });
    expect(office.tablePositions.board).toEqual({ x: 300, y: 330 });
    expect(office.stations.web_search).toEqual({ x: 500, y: 150 });
  });

  it("leaves everything exactly where it always was when nothing has been put anywhere", () => {
    for (const workflow of [demoWorkflow, tablesWorkflow, parallelWorkflow]) {
      expect(buildLayout(placed(workflow, {}))).toEqual(buildLayout(workflow));
      // A place for something the office does not have changes nothing.
      expect(buildLayout(placed(workflow, { ghost: { x: 1, y: 1 }, "table:ghost": { x: 2, y: 2 }, "station:calculator@attic": { x: 3, y: 3 } }))).toEqual(buildLayout(workflow));
    }
    expect(buildLayout(demoWorkflow).homes).toEqual({ anna: { x: 170, y: 280 }, luca: { x: 320, y: 280 }, gianni: { x: 470, y: 280 } });
  });

  it("moves the trays with the agents they stand by", () => {
    const office = buildLayout(placed(demoWorkflow, { anna: { x: 300, y: 200 } }));
    expect(office.trays.in).toEqual({ x: 260, y: 206 });
  });

  it("brings back into the room what a file puts outside it, and ignores what is not a place at all", () => {
    const office = buildLayout(placed(demoWorkflow, { anna: { x: -500, y: 9000 }, luca: { x: Number.NaN, y: 3 }, gianni: { x: 123.4, y: 222.6 } }));
    expect(office.homes.anna).toEqual({ x: BOUNDS.agent.minX, y: BOUNDS.agent.maxY });
    expect(office.homes.gianni).toEqual({ x: 123, y: 223 });
    // Luca's is not a place: he stands where he would have stood, clear of the others.
    expect(Number.isFinite(office.homes.luca.x) && Number.isFinite(office.homes.luca.y)).toBe(true);
  });

  it("keeps those with no place of their own clear of those that were put somewhere", () => {
    // Anna is put exactly where Luca would stand.
    const usual = buildLayout(demoWorkflow).homes.luca;
    const office = buildLayout(placed(demoWorkflow, { anna: usual }));
    expect(office.homes.anna).toEqual(usual);
    const homes = Object.values(office.homes);
    for (const [index, home] of homes.entries()) {
      for (const other of homes.slice(index + 1)) expect(Math.abs(home.x - other.x) >= 44 || Math.abs(home.y - other.y) >= 34).toBe(true);
    }
    // The agents come back in the workflow's order, whoever was placed first.
    expect(Object.keys(office.homes)).toEqual(["anna", "luca", "gianni"]);
  });

  it("stands nobody on top of anybody else, however crowded the office", () => {
    const crowd: Workflow = {
      ...demoWorkflow,
      agents: Array.from({ length: 40 }, (_, index) => ({ ...demoWorkflow.agents[0], id: `agent_${index}`, name: `Agent ${index}` })),
      relations: [],
    };
    const homes = Object.values(buildLayout(crowd).homes);
    expect(homes).toHaveLength(40);
    for (const [index, home] of homes.entries()) {
      expect(clampToRoom("agent", home)).toEqual(home);
      for (const other of homes.slice(index + 1)) expect(Math.abs(home.x - other.x) >= 44 || Math.abs(home.y - other.y) >= 34, `${home.x},${home.y} and ${other.x},${other.y}`).toBe(true);
    }
  });

  it("gives a station of its own, clear of the others, to a tool given after the rest were placed", () => {
    const pinned = placed(demoWorkflow, { "station:web_search@office": { x: 320, y: 100 }, "station:send_email@office": { x: 440, y: 100 } });
    const more: Workflow = { ...pinned, relations: [...pinned.relations, { id: "r9", subject: "anna", verb: "uses_tool", object: "calculator" }] };
    const stations = buildLayout(more).stations;
    expect(stations.web_search).toEqual({ x: 320, y: 100 });
    expect(stations.send_email).toEqual({ x: 440, y: 100 });
    for (const other of [stations.web_search, stations.send_email]) expect(Math.abs(stations.calculator.x - other.x) >= 84 || Math.abs(stations.calculator.y - other.y) >= 60).toBe(true);
  });
});

describe("clampToRoom and freeSpot", () => {
  it("keeps each kind of thing on the floor, at whole pixels", () => {
    expect(clampToRoom("agent", { x: 320.4, y: 200.6 })).toEqual({ x: 320, y: 201 });
    for (const kind of ["agent", "table", "station"] as const) {
      const { minX, maxX, minY, maxY } = BOUNDS[kind];
      expect(clampToRoom(kind, { x: -1000, y: -1000 })).toEqual({ x: minX, y: minY });
      expect(clampToRoom(kind, { x: 1000, y: 1000 })).toEqual({ x: maxX, y: maxY });
      expect(minX).toBeGreaterThan(0);
      expect(maxX).toBeLessThan(ROOM.width);
      expect(minY).toBeGreaterThan(ROOM.wall);
      expect(maxY).toBeLessThan(ROOM.height);
    }
    // A character has to be able to stand in front of a station, inside the room.
    expect(BOUNDS.station.maxY + 70).toBeLessThanOrEqual(BOUNDS.agent.maxY);
  });

  it("takes the usual spot when it is free, and the nearest free one beside it when it is not", () => {
    const wanted = { x: 320, y: 280 };
    expect(freeSpot("agent", wanted, [])).toEqual(wanted);
    expect(freeSpot("agent", wanted, [{ x: 100, y: 280 }])).toEqual(wanted);
    expect(freeSpot("agent", wanted, [wanted])).toEqual({ x: 364, y: 280 });
    expect(freeSpot("agent", wanted, [wanted, { x: 364, y: 280 }])).toEqual({ x: 276, y: 280 });
  });

  it("goes to another row when the whole row is taken, and never leaves the room", () => {
    const row = Array.from({ length: 20 }, (_, index) => ({ x: 24 + index * 32, y: 280 }));
    const spot = freeSpot("agent", { x: 320, y: 280 }, row);
    expect(spot.y).not.toBe(280);
    expect(row.every((other) => Math.abs(spot.x - other.x) >= 44 || Math.abs(spot.y - other.y) >= 34)).toBe(true);
    expect(clampToRoom("agent", spot)).toEqual(spot);
    // With no room left anywhere it still answers, inside the room.
    const everywhere = Array.from({ length: 40 }, (_, x) => Array.from({ length: 20 }, (_, y) => ({ x: x * 16, y: 100 + y * 16 }))).flat();
    expect(clampToRoom("agent", freeSpot("agent", { x: 320, y: 280 }, everywhere))).toEqual(freeSpot("agent", { x: 320, y: 280 }, everywhere));
  });
});

