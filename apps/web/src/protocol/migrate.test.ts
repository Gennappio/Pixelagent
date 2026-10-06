import { describe, expect, it } from "vitest";
import { demoWorkflow, tablesWorkflow, v1Cases } from "../testing/demoRun";
import { isRevision1, upgradeWorkflow } from "./migrate";

describe("upgradeWorkflow", () => {
  it.each(v1Cases.map((entry) => [entry.name, entry] as const))("upgrades “%s” exactly as the server does", (_name, entry) => {
    expect(isRevision1(entry.v1)).toBe(true);
    // The server's answer has no id: an id is the server's to give.
    const { id: _id, ...upgraded } = upgradeWorkflow(entry.v1);
    expect(upgraded).toStrictEqual(entry.v2);
  });

  it("leaves a current workflow as it is", () => {
    for (const workflow of [demoWorkflow, tablesWorkflow]) {
      expect(isRevision1(workflow as never)).toBe(false);
      expect(upgradeWorkflow(workflow as never)).toStrictEqual(workflow);
    }
  });

  it("keeps the id of a workflow that has one, and gives none to one that has not", () => {
    expect(upgradeWorkflow({ ...v1Cases[0].v1, id: "kept" }).id).toBe("kept");
    expect(upgradeWorkflow(v1Cases[0].v1).id).toBe("");
  });

  it("fills the gaps of a current workflow written by hand", () => {
    const sparse = { schemaVersion: 2, id: "x", name: "Sparse", agents: [{ id: "a", name: "A" }], relations: [{ id: "r1", subject: "a", verb: "is_entry" }] };
    const whole = upgradeWorkflow(sparse);
    expect(whole.rooms).toEqual([{ id: "office", name: "Office" }]);
    expect(whole.tables).toEqual([]);
    expect(whole.agents[0]).toMatchObject({ roomId: "office", instances: 1, role: "", model: { provider: "fake", name: "scripted-v1" } });
    expect(whole.budgets.maxEvents).toBe(5000);
    expect(whole.layout).toEqual({ positions: {} });
  });
});
