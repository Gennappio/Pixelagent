import { describe, expect, it } from "vitest";
import { EventAnimation, worldStateAt } from "../animation/EventAnimation";
import { mapEventToActions } from "../animation/VisualEventMapper";
import { foldDocuments, latestVersion } from "../protocol/documents";
import { demoEvents, demoWorkflow, parallelEvents, parallelWorkflow, tablesEvents, tablesWorkflow } from "../testing/demoRun";
import { buildLayout } from "./layout";
import { actionDuration, applyAction, initialWorldState, SHEET_TRAVEL, sheetPosition, TABLE_DISTANCE } from "./worldState";

const demoLayout = buildLayout(demoWorkflow);
const officeLayout = buildLayout(tablesWorkflow);
const RUNS = [
  ["the demo", demoEvents, demoLayout],
  ["the run with tables", tablesEvents, officeLayout],
  ["the run with two agents at once", parallelEvents, buildLayout(parallelWorkflow)],
] as const;

describe("the world and the document registry agree", () => {
  // The registry is one fold of the log, the world another, through the mapper.
  // After every event they must tell the same story about which sheets are in sight.
  it.each(RUNS)("after every event of %s, the sheets in sight are the ones not filed", (_name, events, layout) => {
    for (let count = 0; count <= events.length; count++) {
      const registry = foldDocuments(events.slice(0, count));
      const expected = registry.order
        .map((id) => registry.documents[id])
        .filter((record) => record.place.kind !== "filed")
        .map((record) => [record.id, record.place, latestVersion(record).version, latestVersion(record).title]);
      const shown = Object.values(worldStateAt(events, count, layout).documents).map((sheet) => [
        sheet.documentId,
        sheet.place,
        sheet.version,
        sheet.title,
      ]);
      expect(new Map(shown.map(([id, ...rest]) => [id, rest])), `after event #${count}`).toEqual(
        new Map(expected.map(([id, ...rest]) => [id, rest])),
      );
    }
  });

  it.each(RUNS)("leaves no sheet in mid-air once an event of %s has settled", (_name, events, layout) => {
    for (let count = 0; count <= events.length; count++) {
      for (const sheet of Object.values(worldStateAt(events, count, layout).documents)) {
        expect(sheet.transit, `${sheet.documentId} after #${count}`).toBeUndefined();
        expect(sheetPosition(worldStateAt(events, count, layout), layout, sheet)).toBeDefined();
      }
    }
  });

  it("ends the demo with only the result in sight, in the out-tray", () => {
    const end = worldStateAt(demoEvents, demoEvents.length, demoLayout);
    expect(Object.values(end.documents)).toEqual([
      { documentId: "doc_3", title: "Result", version: 1, place: { kind: "tray", tray: "out" } },
    ]);
  });

  it("shows nothing for a log written before documents existed", () => {
    const legacy = demoEvents.map((event) => {
      const { documentId: _d, documentIds: _ds, version: _v, title: _t, authorId: _a, ...payload } = event.payload;
      return { ...event, payload };
    });
    for (let count = 0; count <= legacy.length; count++) {
      expect(worldStateAt(legacy, count, demoLayout).documents).toEqual({});
    }
  });
});

describe("a sheet changing hands", () => {
  // Anna has just written doc_1 and is about to hand it to Luca (event 4).
  const before = worldStateAt(demoEvents, 3, demoLayout);
  const actions = mapEventToActions(demoEvents[3]);

  it("takes visualization time, and passes through the air between the two", () => {
    const animation = new EventAnimation(before, actions, demoLayout);
    const seen = new Set<string>();
    let frames = 0;
    while (!animation.done && frames < 10_000) {
      animation.advance(16);
      frames += 1;
      const sheet = animation.applyTo(before).documents.doc_1;
      if (!sheet) continue;
      seen.add(sheet.transit ? "in the air" : `${sheet.place.kind}:${"agentId" in sheet.place ? sheet.place.agentId : ""}`);
      if (sheet.transit) {
        expect(sheet.transit.progress).toBeGreaterThanOrEqual(0);
        expect(sheet.transit.progress).toBeLessThan(1);
      }
    }
    expect([...seen]).toEqual(["hand:anna", "in the air", "hand:luca"]);
    expect(animation.applyTo(before).documents.doc_1.place).toEqual({ kind: "hand", agentId: "luca" });
  });

  it("travels with whoever holds it", () => {
    const carrying = applyAction(before, actions[0], 1, demoLayout); // doc_1 in Anna's hand
    const halfway = applyAction(carrying, actions[1], 0.5, demoLayout); // Anna halfway to Luca
    const sheet = halfway.documents.doc_1;
    const at = sheetPosition(halfway, demoLayout, sheet)!;
    const anna = halfway.agents.anna.position;
    expect(Math.abs(at.x - anna.x)).toBeLessThan(30);
    expect(at.y).toBeLessThan(anna.y); // at hand height, above the feet
    expect(anna.x).toBeGreaterThan(demoLayout.homes.anna.x);
  });

  it("costs time only when the sheet actually has to move", () => {
    const hand = { type: "HAND_DOCUMENT", documentId: "doc_input", to: { kind: "hand", agentId: "luca" } } as const;
    const holding = worldStateAt(demoEvents, 2, demoLayout); // doc_input in Anna's hand
    expect(actionDuration(holding, hand, demoLayout)).toBe(SHEET_TRAVEL);
    expect(actionDuration(holding, { ...hand, to: { kind: "hand", agentId: "anna" } }, demoLayout)).toBe(0);
    expect(actionDuration(holding, { ...hand, documentId: "doc_unknown" }, demoLayout)).toBe(0);
    expect(applyAction(holding, { ...hand, documentId: "doc_unknown" }, 1, demoLayout)).toBe(holding);
  });

  it("files only what the finishing agent holds", () => {
    const state = worldStateAt(demoEvents, 4, demoLayout); // Anna holds doc_input, Luca holds doc_1
    const filed = applyAction(state, { type: "FILE_DOCUMENTS", agentId: "anna" }, 1, demoLayout);
    expect(Object.keys(filed.documents)).toEqual(["doc_1"]);
    expect(applyAction(filed, { type: "FILE_DOCUMENTS", agentId: "anna" }, 1, demoLayout)).toBe(filed);
  });
});

describe("sheets on tables", () => {
  it("stacks a pile and spreads a shared table", () => {
    const piled = worldStateAt(tablesEvents, 9, officeLayout); // the splitter has put two sheets on the pile
    const spot = (state: typeof piled, id: string) => sheetPosition(state, officeLayout, state.documents[id])!;
    const pile = officeLayout.tablePositions.todo;
    expect(spot(piled, "doc_2").x).toBe(pile.x);
    expect(spot(piled, "doc_3").x).toBe(pile.x);
    expect(spot(piled, "doc_3").y).toBeLessThan(spot(piled, "doc_2").y); // the second lies on top of the first
    const written = worldStateAt(tablesEvents, 17, officeLayout); // Luca's first note is on the board
    expect(Math.abs(spot(written, "doc_5").x - officeLayout.tablePositions.board.x)).toBeLessThan(30);
  });

  it("keeps a shared sheet in its spot when a new version is put down", () => {
    const spotAfter = (count: number) => {
      const state = worldStateAt(tablesEvents, count, officeLayout);
      return [state.documents.doc_5.version, sheetPosition(state, officeLayout, state.documents.doc_5)];
    };
    expect(spotAfter(17)[0]).toBe(1);
    expect(spotAfter(25)[0]).toBe(2);
    expect(spotAfter(40)[0]).toBe(2);
    expect(spotAfter(25)[1]).toEqual(spotAfter(17)[1]);
    expect(spotAfter(40)[1]).toEqual(spotAfter(17)[1]);
  });

  it("stands the agent beside the table, facing it", () => {
    const start = initialWorldState(officeLayout);
    const walk = { type: "MOVE_TO", agentId: "luca", target: { kind: "table", id: "board" } } as const;
    const arrived = applyAction(start, walk, 1, officeLayout).agents.luca;
    const table = officeLayout.tablePositions.board;
    expect(Math.abs(arrived.position.x - table.x)).toBe(TABLE_DISTANCE);
    expect(arrived.position.y).toBe(table.y);
    expect(arrived.facing).toBe(arrived.position.x < table.x ? "right" : "left");
    expect(actionDuration(start, walk, officeLayout)).toBeGreaterThan(0);
  });

  it("does not walk to a table the office does not have", () => {
    const start = initialWorldState(demoLayout);
    const walk = { type: "MOVE_TO", agentId: "luca", target: { kind: "table", id: "board" } } as const;
    expect(applyAction(start, walk, 1, demoLayout)).toBe(start);
    expect(actionDuration(start, walk, demoLayout)).toBe(0);
  });

  it("draws nothing for a sheet whose tray the layout does not have", () => {
    const noTrays = { ...demoLayout, trays: {} };
    const state = worldStateAt(demoEvents, 1, noTrays);
    expect(sheetPosition(state, noTrays, state.documents.doc_input)).toBeUndefined();
  });
});
