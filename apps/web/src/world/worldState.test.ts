import { describe, expect, it } from "vitest";
import { EventAnimation, worldStateAt } from "../animation/EventAnimation";
import { mapEventToActions } from "../animation/VisualEventMapper";
import { foldDocuments, latestVersion } from "../protocol/documents";
import { demoEvents, demoWorkflow, indexOfEvent, oldRuns, parallelEvents, parallelWorkflow, sequenceOf, tablesEvents, tablesWorkflow } from "../testing/demoRun";
import { buildLayout } from "./layout";
import { actionDuration, applyAction, initialWorldState, SHEET_TRAVEL, sheetPosition, TABLE_DISTANCE } from "./worldState";

const demoLayout = buildLayout(demoWorkflow);
const officeLayout = buildLayout(tablesWorkflow);
const parallelLayout = buildLayout(parallelWorkflow);
const RUNS = [
  ["the demo", demoEvents, demoLayout],
  ["the run with tables", tablesEvents, officeLayout],
  ["the run with two agents at once", parallelEvents, parallelLayout],
  // Logs from before a hand-off had words of its own must go on replaying as they did.
  ...oldRuns.map((run) => [run.name, run.events, buildLayout(run.workflow)] as const),
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
      { documentId: "doc_2", title: "Email sent", version: 1, place: { kind: "tray", tray: "out" } },
    ]);
  });

  it("brings a filed sheet back into sight when it turns out to be the result", () => {
    // Marta rewrote the sheet Luca handed her. Her turn over, it is filed and out of sight…
    const last = parallelEvents.length;
    expect(parallelEvents[last - 2].type).toBe("AGENT_FINISHED");
    expect(worldStateAt(parallelEvents, last - 1, parallelLayout).documents).toEqual({});
    // …and the run finishing puts that same sheet, in its new version, in the out-tray.
    expect(Object.values(worldStateAt(parallelEvents, last, parallelLayout).documents)).toEqual([
      { documentId: "doc_2", title: "Sales number", version: 2, place: { kind: "tray", tray: "out" } },
    ]);
  });

  it("shows two sheets where one was photocopied, each with whoever was handed it", () => {
    // After Anna's turn: the task is Luca's, its photocopy Gianni's.
    const sheets = Object.values(worldStateAt(parallelEvents, sequenceOf(parallelEvents, "AGENT_FINISHED", "anna"), parallelLayout).documents).map((sheet) => [sheet.documentId, sheet.title, sheet.place]);
    expect(sheets).toEqual([
      ["doc_input", "Task", { kind: "hand", agentId: "luca" }],
      ["doc_1", "Task", { kind: "hand", agentId: "gianni" }],
    ]);
  });

  it("puts no sheet anywhere for words alone", () => {
    const told = parallelEvents.findIndex((event) => event.type === "MESSAGE_SENT" && event.actorId === "gianni");
    expect(worldStateAt(parallelEvents, told + 1, parallelLayout).documents).toEqual(worldStateAt(parallelEvents, told, parallelLayout).documents);
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
  // Anna holds the task and is about to hand it to Luca.
  const handOff = indexOfEvent(demoEvents, "MESSAGE_SENT", "anna");
  const before = worldStateAt(demoEvents, handOff, demoLayout);
  const actions = mapEventToActions(demoEvents[handOff]);

  it("takes visualization time, and passes through the air between the two", () => {
    const animation = new EventAnimation(before, actions, demoLayout);
    const seen = new Set<string>();
    let frames = 0;
    while (!animation.done && frames < 10_000) {
      animation.advance(16);
      frames += 1;
      const sheet = animation.applyTo(before).documents.doc_input;
      if (!sheet) continue;
      seen.add(sheet.transit ? "in the air" : `${sheet.place.kind}:${"agentId" in sheet.place ? sheet.place.agentId : ""}`);
      if (sheet.transit) {
        expect(sheet.transit.progress).toBeGreaterThanOrEqual(0);
        expect(sheet.transit.progress).toBeLessThan(1);
      }
    }
    expect([...seen]).toEqual(["hand:anna", "in the air", "hand:luca"]);
    expect(animation.applyTo(before).documents.doc_input.place).toEqual({ kind: "hand", agentId: "luca" });
  });

  it("travels with whoever holds it", () => {
    expect(before.documents.doc_input.place).toEqual({ kind: "hand", agentId: "anna" });
    const carrying = applyAction(before, actions[0], 1, demoLayout); // still in Anna's hand: she is not writing a new one
    expect(carrying.documents).toEqual(before.documents);
    const halfway = applyAction(carrying, actions[1], 0.5, demoLayout); // Anna halfway to Luca
    const sheet = halfway.documents.doc_input;
    const at = sheetPosition(halfway, demoLayout, sheet)!;
    const anna = halfway.agents.anna.position;
    expect(Math.abs(at.x - anna.x)).toBeLessThan(30);
    expect(at.y).toBeLessThan(anna.y); // at hand height, above the feet
    expect(anna.x).toBeGreaterThan(demoLayout.homes.anna.x);
  });

  it("costs time only when the sheet actually has to move", () => {
    const hand = { type: "HAND_DOCUMENT", documentId: "doc_input", to: { kind: "hand", agentId: "luca" } } as const;
    const holding = worldStateAt(demoEvents, sequenceOf(demoEvents, "AGENT_STARTED", "anna"), demoLayout); // doc_input in Anna's hand
    expect(actionDuration(holding, hand, demoLayout)).toBe(SHEET_TRAVEL);
    expect(actionDuration(holding, { ...hand, to: { kind: "hand", agentId: "anna" } }, demoLayout)).toBe(0);
    expect(actionDuration(holding, { ...hand, documentId: "doc_unknown" }, demoLayout)).toBe(0);
    expect(applyAction(holding, { ...hand, documentId: "doc_unknown" }, 1, demoLayout)).toBe(holding);
  });

  it("files only what the finishing agent holds", () => {
    // Luca has handed on the sheet he wrote: he still holds the task, Gianni holds the new sheet.
    const state = worldStateAt(demoEvents, sequenceOf(demoEvents, "MESSAGE_SENT", "luca"), demoLayout);
    expect(Object.values(state.documents).map((sheet) => [sheet.documentId, sheet.place])).toEqual([
      ["doc_input", { kind: "hand", agentId: "luca" }],
      ["doc_1", { kind: "hand", agentId: "gianni" }],
    ]);
    const filed = applyAction(state, { type: "FILE_DOCUMENTS", agentId: "luca" }, 1, demoLayout);
    expect(Object.keys(filed.documents)).toEqual(["doc_1"]);
    expect(applyAction(filed, { type: "FILE_DOCUMENTS", agentId: "luca" }, 1, demoLayout)).toBe(filed);
    // Anna, who passed her only sheet on, has nothing to file.
    expect(applyAction(state, { type: "FILE_DOCUMENTS", agentId: "anna" }, 1, demoLayout)).toBe(state);
  });
});

describe("sheets on tables", () => {
  it("stacks a pile and spreads a shared table", () => {
    const piled = worldStateAt(tablesEvents, sequenceOf(tablesEvents, "AGENT_FINISHED", "sorter"), officeLayout); // the splitter has put two sheets on the pile
    const spot = (state: typeof piled, id: string) => sheetPosition(state, officeLayout, state.documents[id])!;
    const pile = officeLayout.tablePositions.todo;
    expect(spot(piled, "doc_2").x).toBe(pile.x);
    expect(spot(piled, "doc_3").x).toBe(pile.x);
    expect(spot(piled, "doc_3").y).toBeLessThan(spot(piled, "doc_2").y); // the second lies on top of the first
    const written = worldStateAt(tablesEvents, sequenceOf(tablesEvents, "AGENT_FINISHED", "luca"), officeLayout); // Luca's first finding is on the board
    expect(Math.abs(spot(written, "doc_5").x - officeLayout.tablePositions.board.x)).toBeLessThan(30);
  });

  it("keeps a shared sheet in its spot when a new version is put down", () => {
    const spotAfter = (count: number) => {
      const state = worldStateAt(tablesEvents, count, officeLayout);
      return [state.documents.doc_5.version, sheetPosition(state, officeLayout, state.documents.doc_5)];
    };
    // Luca writes on the pile of what is done and then on the board, twice: his 2nd and 4th writes are the board's.
    const first = sequenceOf(tablesEvents, "DOCUMENT_WRITTEN", "luca", 1);
    const second = sequenceOf(tablesEvents, "DOCUMENT_WRITTEN", "luca", 3);
    expect([tablesEvents[first - 1].payload.tableId, tablesEvents[second - 1].payload.version]).toEqual(["board", 2]);
    expect(spotAfter(first)[0]).toBe(1);
    expect(spotAfter(second - 1)[0]).toBe(1);
    expect(spotAfter(second)[0]).toBe(2);
    expect(spotAfter(tablesEvents.length)[0]).toBe(2);
    expect(spotAfter(second)[1]).toEqual(spotAfter(first)[1]);
    expect(spotAfter(tablesEvents.length)[1]).toEqual(spotAfter(first)[1]);
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
