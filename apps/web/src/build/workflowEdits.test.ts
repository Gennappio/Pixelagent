import { describe, expect, it } from "vitest";
import { entryOf, sentence } from "../protocol/relations";
import type { Workflow } from "../protocol/workflow";
import { demoWorkflow, tablesWorkflow } from "../testing/demoRun";
import {
  addAgent,
  addRelation,
  addTable,
  canRelate,
  emptyWorkflow,
  moveRelation,
  objectChoices,
  removeAgent,
  removeRelation,
  removeTable,
  updateAgent,
  updateRelation,
  updateTable,
} from "./workflowEdits";

const TOOLS = ["web_search", "send_email", "calculator"];
const say = (workflow: Workflow) => workflow.relations.map((relation) => sentence(workflow, relation));

describe("agents", () => {
  it("adds agents with fresh stable ids, in the office's room", () => {
    const first = addAgent(emptyWorkflow());
    const second = addAgent(first.workflow);
    expect(second.workflow.agents).toHaveLength(2);
    expect(first.agent.id).not.toBe(second.agent.id);
    expect(second.agent).toMatchObject({ name: "Agent 2", roomId: "office", instances: 1 });
  });

  it("changes an agent without touching the others", () => {
    const renamed = updateAgent(demoWorkflow, "luca", { name: "Luke" });
    expect(renamed.agents.map((agent) => agent.name)).toEqual(["Anna", "Luke", "Gianni"]);
    expect(renamed.agents[0]).toBe(demoWorkflow.agents[0]);
    expect(demoWorkflow.agents[1].name).toBe("Luca");
  });

  it("removing an agent removes what it does and what others do with it", () => {
    const without = removeAgent(demoWorkflow, "luca");
    expect(without.agents.map((agent) => agent.id)).toEqual(["anna", "gianni"]);
    expect(say(without)).toEqual(["Anna is the entry", "Gianni can use send_email", "Gianni is the exit"]);
    expect(removeAgent(demoWorkflow, "nobody")).toBe(demoWorkflow);
  });

  it("does not take a tool with the same name as a removed agent for the agent", () => {
    // "luca" as a tool name is a tool, whatever agents are called.
    const odd = addRelation(demoWorkflow, "anna", "uses_tool", "luca");
    expect(say(removeAgent(odd, "luca"))).toContain("Anna can use luca");
  });
});

describe("sentences", () => {
  it("adds a sentence after the ones the agent already has", () => {
    const more = addRelation(demoWorkflow, "anna", "uses_tool", "calculator");
    expect(say(more).slice(0, 3)).toEqual(["Anna is the entry", "Anna hands a sheet to Luca", "Anna can use calculator"]);
    expect(more.relations[2].id).toBe("r7");
    expect(say(addRelation(emptyAnd("solo"), "solo", "is_entry"))).toEqual(["Solo is the entry"]);
  });

  it("moves being the entry, or the exit, from whoever had it", () => {
    const moved = addRelation(demoWorkflow, "luca", "is_entry");
    expect(entryOf(moved)?.id).toBe("luca");
    expect(say(moved).filter((line) => line.endsWith("is the entry"))).toEqual(["Luca is the entry"]);
  });

  it("refuses sentences that make no sense, as the server would", () => {
    const office = tablesWorkflow;
    expect(canRelate(office, "anna", "sends_to", "anna")).toBe(false); // to itself
    expect(canRelate(office, "anna", "sends_to", "sorter")).toBe(false); // already said
    expect(canRelate(office, "anna", "sends_to", "nobody")).toBe(false);
    expect(canRelate(office, "nobody", "sends_to", "anna")).toBe(false);
    expect(canRelate(office, "anna", "sends_to")).toBe(false); // needs an object
    expect(canRelate(office, "anna", "is_exit", "luca")).toBe(false); // takes none
    expect(canRelate(office, "anna", "takes_from_table", "board")).toBe(false); // a shared table is not taken from
    expect(canRelate(office, "anna", "reads_table", "todo")).toBe(false); // a pile is not read
    expect(canRelate(office, "anna", "reads_table", "board")).toBe(true);
    expect(canRelate(office, "anna", "writes_table", "todo")).toBe(true);
    expect(addRelation(office, "anna", "sends_to", "anna")).toBe(office);
  });

  it("offers only what a sentence could still end with", () => {
    const ids = (verb: Parameters<typeof objectChoices>[2], subject = "luca") => objectChoices(tablesWorkflow, subject, verb, TOOLS).map((choice) => choice.id);
    expect(ids("sends_to")).toEqual(["anna", "sorter", "stapler", "gianni"]);
    expect(ids("uses_tool")).toEqual(["send_email", "calculator"]); // already has web_search
    expect(ids("takes_from_table")).toEqual(["done"]); // piles only, minus the one it takes from
    expect(ids("reads_table")).toEqual(["board"]); // shared tables only
    expect(ids("writes_table")).toEqual(["todo"]); // it already writes on the other two
    expect(ids("is_entry")).toEqual([]);
  });

  it("removes a sentence, and nothing when there is none to remove", () => {
    expect(say(removeRelation(demoWorkflow, "r3"))).not.toContain("Luca can use web_search");
    expect(removeRelation(demoWorkflow, "nope")).toBe(demoWorkflow);
  });

  it("leaves defaults unsaid, as on the wire", () => {
    const optional = updateRelation(demoWorkflow, "r2", { required: false, hint: "only if unsure", maxRounds: 3 });
    expect(optional.relations[1]).toEqual({ id: "r2", subject: "anna", verb: "sends_to", object: "luca", required: false, hint: "only if unsure", maxRounds: 3 });
    const back = updateRelation(optional, "r2", { required: true, hint: "", maxRounds: undefined });
    expect(back.relations[1]).toEqual(demoWorkflow.relations[1]);
  });

  it("does not let a verb that always happens be marked as a choice", () => {
    expect(updateRelation(demoWorkflow, "r3", { required: false }).relations[2]).toEqual(demoWorkflow.relations[2]);
  });

  it("reorders a sentence among the same agent's, leaving the others where they are", () => {
    const extra = addRelation(addRelation(demoWorkflow, "anna", "sends_to", "gianni"), "anna", "uses_tool", "calculator");
    const order = (workflow: Workflow) => workflow.relations.filter((relation) => relation.subject === "anna").map((relation) => relation.verb + (relation.object ?? ""));
    expect(order(extra)).toEqual(["is_entry", "sends_toluca", "sends_togianni", "uses_toolcalculator"]);
    const moved = moveRelation(extra, extra.relations[2].id, -1);
    expect(order(moved)).toEqual(["is_entry", "sends_togianni", "sends_toluca", "uses_toolcalculator"]);
    expect(moved.relations.filter((relation) => relation.subject !== "anna")).toEqual(extra.relations.filter((relation) => relation.subject !== "anna"));
    // The first cannot go earlier, the last cannot go later.
    expect(moveRelation(extra, "r1", -1)).toBe(extra);
    expect(moveRelation(extra, extra.relations[3].id, 1)).toBe(extra);
  });
});

describe("tables", () => {
  it("adds a table or a pile", () => {
    const table = addTable(emptyWorkflow());
    const pile = addTable(table.workflow, "pile");
    expect(pile.workflow.tables.map((entry) => [entry.name, entry.mode, entry.roomId])).toEqual([
      ["Table 1", "shared", "office"],
      ["Pile 2", "pile", "office"],
    ]);
  });

  it("drops the sentences that stop making sense when a table changes kind", () => {
    const asPile = updateTable(tablesWorkflow, "board", { mode: "pile" });
    expect(say(asPile)).not.toContain("Gianni reads Board");
    expect(say(asPile)).toContain("Luca writes on Board");
    const asTable = updateTable(tablesWorkflow, "todo", { mode: "shared" });
    expect(say(asTable)).not.toContain("Luca takes from To research");
    expect(say(asTable)).toContain("Sorter writes on To research");
    // Renaming changes nothing else.
    expect(updateTable(tablesWorkflow, "board", { name: "Wall" }).relations).toEqual(tablesWorkflow.relations);
  });

  it("removing a table removes the sentences that use it", () => {
    const without = removeTable(tablesWorkflow, "todo");
    expect(without.tables.map((table) => table.id)).toEqual(["done", "board"]);
    expect(say(without).some((line) => line.includes("To research"))).toBe(false);
    expect(removeTable(tablesWorkflow, "nope")).toBe(tablesWorkflow);
  });
});

function emptyAnd(agentId: string): Workflow {
  const base = emptyWorkflow();
  return { ...base, agents: [{ id: agentId, name: agentId[0].toUpperCase() + agentId.slice(1), role: "", roomId: "office", instances: 1, model: { provider: "fake", name: "scripted-v1" }, systemPrompt: "", appearance: { sprite: "agent_male_01" } }] };
}
