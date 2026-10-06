import { describe, expect, it } from "vitest";
import { demoWorkflow, tablesWorkflow } from "../testing/demoRun";
import { buildLayout, EMPTY_LAYOUT, ROOM, terminalAgents } from "./layout";

describe("terminalAgents", () => {
  it("finds who receives the task and who delivers the result", () => {
    expect(terminalAgents(demoWorkflow)).toEqual({ entry: "anna", exit: "gianni" });
  });

  it("finds nobody in a graph that is not wired up", () => {
    expect(terminalAgents({ ...demoWorkflow, edges: [] })).toEqual({ entry: undefined, exit: undefined });
  });

  it("can be the same agent at both ends", () => {
    const solo = {
      ...demoWorkflow,
      agents: demoWorkflow.agents.slice(0, 1),
      nodes: demoWorkflow.nodes.filter((node) => ["start", "node_anna", "end"].includes(node.id)),
      edges: [
        { id: "a", source: "start", target: "node_anna" },
        { id: "b", source: "node_anna", target: "end" },
      ],
    };
    expect(terminalAgents(solo)).toEqual({ entry: "anna", exit: "anna" });
    const { trays, homes } = buildLayout(solo);
    expect(trays.in!.x).toBeLessThan(homes.anna.x);
    expect(trays.out!.x).toBeGreaterThan(homes.anna.x);
  });
});

describe("buildLayout", () => {
  const layout = buildLayout(demoWorkflow);

  it("stands the in-tray by the first agent and the out-tray by the last, inside the room", () => {
    expect(layout.trays.in!.x).toBeLessThan(layout.homes.anna.x);
    expect(layout.trays.out!.x).toBeGreaterThan(layout.homes.gianni.x);
    for (const tray of [layout.trays.in!, layout.trays.out!]) {
      expect(tray.x).toBeGreaterThan(0);
      expect(tray.x).toBeLessThan(ROOM.width);
      expect(Math.abs(tray.y - layout.homes.anna.y)).toBeLessThan(20);
    }
  });

  it("has no trays when the graph does not say where the task enters or leaves", () => {
    expect(buildLayout({ ...demoWorkflow, edges: [] }).trays).toEqual({});
  });

  it("has no tables for the demo, and none for a workflow saved before tables existed", () => {
    expect(layout.tables).toEqual([]);
    const { tables: _absent, ...legacy } = demoWorkflow;
    expect(buildLayout(legacy).tables).toEqual([]);
    expect(buildLayout(legacy).homes).toEqual(layout.homes);
  });

  it("places each table in the room and moves the agents back to make room", () => {
    const office = buildLayout(tablesWorkflow);
    expect(office.tables).toEqual([
      { id: "todo", name: "To research", mode: "pile" },
      { id: "board", name: "Board", mode: "shared" },
    ]);
    for (const table of office.tables) {
      const position = office.tablePositions[table.id];
      expect(position.x).toBeGreaterThan(0);
      expect(position.x).toBeLessThan(ROOM.width);
      expect(position.y).toBeLessThan(ROOM.height);
      expect(position.y).toBeGreaterThan(office.homes.anna.y + 40);
    }
    expect(office.tablePositions.todo.x).not.toBe(office.tablePositions.board.x);
    expect(office.homes.anna.y).toBeLessThan(layout.homes.anna.y);
  });

  it("is the same every time for the same workflow", () => {
    expect(buildLayout(tablesWorkflow)).toEqual(buildLayout(tablesWorkflow));
    expect(EMPTY_LAYOUT.tables).toEqual([]);
  });
});
