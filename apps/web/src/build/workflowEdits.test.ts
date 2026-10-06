import { describe, expect, it } from "vitest";
import { entryOf, sentence } from "../protocol/relations";
import type { ToolDescription, Workflow } from "../protocol/workflow";
import { demoWorkflow, tablesWorkflow } from "../testing/demoRun";
import { buildLayout } from "../world/layout";
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

/** The server's three tools, as GET /tools lists them. */
const TOOLS: ToolDescription[] = [
  { name: "web_search", description: "", schema: {}, consultable: true },
  { name: "send_email", description: "", schema: {}, consultable: false },
  { name: "calculator", description: "", schema: {}, consultable: true },
];
const say = (workflow: Workflow) => workflow.relations.map((relation) => sentence(workflow, relation));

describe("agents", () => {
  it("adds agents with fresh stable ids, in the office's room", () => {
    const first = addAgent(emptyWorkflow());
    const second = addAgent(first.workflow);
    expect(second.workflow.agents).toHaveLength(2);
    expect(first.agent.id).not.toBe(second.agent.id);
    expect(second.agent).toMatchObject({ name: "Agent 2", roomId: "office", instances: 1 });
  });

  it("gives each newcomer a look the fewest others have, so they can be told apart", () => {
    let office = emptyWorkflow();
    const looks: string[] = [];
    for (let index = 0; index < 5; index++) {
      const added = addAgent(office);
      office = added.workflow;
      looks.push(added.agent.appearance.sprite);
    }
    expect(looks.slice(0, 4)).toEqual(["agent_male_01", "agent_female_01", "agent_male_02", "agent_female_02"]);
    expect(looks[4]).toBe("agent_male_01"); // everyone has one: start again
    // In the demo Anna has the red jacket, Luca the blue shirt, Gianni the green one: a fourth gets what is left.
    expect(addAgent(demoWorkflow).agent.appearance.sprite).toBe("agent_female_02");
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

describe("putting things down in the room", () => {
  it("adds a character where it is put, and moves nobody to make room", () => {
    const before = buildLayout(demoWorkflow);
    const added = addAgent(demoWorkflow, { x: 100.6, y: 330.2 });
    const after = buildLayout(added.workflow);
    expect(after.homes[added.agent.id]).toEqual({ x: 101, y: 330 });
    for (const id of ["anna", "luca", "gianni"]) expect(after.homes[id]).toEqual(before.homes[id]);
    expect(after.stations).toEqual(before.stations);
    // Added from a list, with nowhere in particular to stand, it takes its place among the others as before.
    const anywhere = addAgent(demoWorkflow);
    expect(anywhere.workflow.layout.positions).toEqual({});
    expect(Object.keys(buildLayout(anywhere.workflow).homes)).toHaveLength(4);
  });

  it("adds a table or a pile where it is put, inside the room", () => {
    const table = addTable(demoWorkflow, "shared", { x: 200, y: 320 });
    expect(buildLayout(table.workflow).tablePositions[table.table.id]).toEqual({ x: 200, y: 320 });
    const pile = addTable(table.workflow, "pile", { x: -50, y: 5000 });
    const at = buildLayout(pile.workflow).tablePositions[pile.table.id];
    expect(at.x).toBeGreaterThan(0);
    expect(at.y).toBeLessThan(400);
    expect(buildLayout(pile.workflow).tablePositions[table.table.id]).toEqual({ x: 200, y: 320 });
  });

  it("forgets where something stood when it is removed", () => {
    const added = addAgent(demoWorkflow, { x: 100, y: 330 });
    const gone = removeAgent(added.workflow, added.agent.id);
    expect(added.agent.id in added.workflow.layout.positions).toBe(true);
    expect(added.agent.id in gone.layout.positions).toBe(false);
    // The others stay written down where they stood.
    expect(buildLayout(gone)).toEqual(buildLayout(demoWorkflow));

    const table = addTable(demoWorkflow, "pile", { x: 300, y: 340 });
    expect(Object.keys(removeTable(table.workflow, table.table.id).layout.positions).some((key) => key.startsWith("table:"))).toBe(false);
  });
});

describe("sentences", () => {
  it("adds a sentence after the ones the agent already has", () => {
    const more = addRelation(demoWorkflow, "anna", "uses_tool", "calculator");
    expect(say(more).slice(0, 3)).toEqual(["Anna is the entry", "Anna hands to Luca", "Anna can use calculator"]);
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
    const ids = (verb: Parameters<typeof objectChoices>[2], subject = "luca", required?: boolean) =>
      objectChoices(tablesWorkflow, subject, verb, { tools: TOOLS, required }).map((choice) => choice.id);
    expect(ids("sends_to")).toEqual(["anna", "sorter", "stapler", "gianni"]);
    expect(ids("uses_tool")).toEqual(["send_email", "calculator"]); // already has web_search
    // To consult first, only tools that can be: the email needs more than one argument.
    expect(ids("uses_tool", "luca", true)).toEqual(["calculator"]);
    expect(ids("uses_tool", "anna", true)).toEqual(["web_search", "calculator"]);
    // Which tools exist is the server's knowledge: without its list there are none to offer.
    expect(objectChoices(tablesWorkflow, "luca", "uses_tool")).toEqual([]);
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

  it("does not mark as a choice a verb that is not one", () => {
    const waiting = addRelation(demoWorkflow, "gianni", "waits_for", "luca");
    const id = waiting.relations.find((relation) => relation.verb === "waits_for")!.id;
    expect(updateRelation(waiting, id, { required: false }).relations).toEqual(waiting.relations);
    expect(updateRelation(demoWorkflow, "r1", { required: false }).relations[0]).toEqual(demoWorkflow.relations[0]);
    expect(updateRelation(demoWorkflow, "nope", { required: false })).toBe(demoWorkflow);
  });

  it("switches a tool between one the agent can use and one it consults first", () => {
    // r3: Luca can use web_search, which takes one text argument.
    const first = updateRelation(demoWorkflow, "r3", { required: true }, TOOLS);
    expect(first.relations[2]).toEqual({ id: "r3", subject: "luca", verb: "uses_tool", object: "web_search", required: true });
    expect(say(first)).toContain("Luca consults first web_search");
    // Back to the default, which is left unsaid.
    expect(updateRelation(first, "r3", { required: false }, TOOLS).relations[2]).toEqual(demoWorkflow.relations[2]);
    expect(updateRelation(demoWorkflow, "r3", { required: false }, TOOLS).relations[2]).toEqual(demoWorkflow.relations[2]);
  });

  it("refuses to have a tool consulted first that cannot be, as the server would at run time", () => {
    // r5: Gianni can use send_email, which needs a recipient and a body.
    expect(updateRelation(demoWorkflow, "r5", { required: true }, TOOLS)).toBe(demoWorkflow);
    // Without the server's list no tool is known to be consultable.
    expect(updateRelation(demoWorkflow, "r3", { required: true })).toBe(demoWorkflow);
    expect(canRelate(demoWorkflow, "anna", "uses_tool", "send_email", { required: true, tools: TOOLS })).toBe(false);
    expect(canRelate(demoWorkflow, "anna", "uses_tool", "send_email", { tools: TOOLS })).toBe(true);
    expect(canRelate(demoWorkflow, "anna", "uses_tool", "calculator", { required: true, tools: TOOLS })).toBe(true);
    expect(canRelate(demoWorkflow, "anna", "uses_tool", "calculator", { required: true })).toBe(false);
    expect(addRelation(demoWorkflow, "anna", "uses_tool", "send_email", { required: true, tools: TOOLS })).toBe(demoWorkflow);
    // One that already is, from a file say, can still be switched back.
    const odd: Workflow = { ...demoWorkflow, relations: demoWorkflow.relations.map((relation) => (relation.id === "r5" ? { ...relation, required: true } : relation)) };
    expect(updateRelation(odd, "r5", { required: false }, TOOLS).relations[4]).toEqual(demoWorkflow.relations[4]);
  });

  it("adds a sentence the way it is said, leaving the verb's default unsaid", () => {
    const added = (verb: Parameters<typeof addRelation>[2], object: string, required?: boolean) => {
      const next = addRelation(demoWorkflow, "anna", verb, object, { required, tools: TOOLS });
      return next.relations.find((relation) => relation.id === "r7");
    };
    expect(added("uses_tool", "calculator", true)).toEqual({ id: "r7", subject: "anna", verb: "uses_tool", object: "calculator", required: true });
    expect(added("uses_tool", "calculator", false)).toEqual({ id: "r7", subject: "anna", verb: "uses_tool", object: "calculator" });
    expect(added("sends_to", "gianni", false)).toEqual({ id: "r7", subject: "anna", verb: "sends_to", object: "gianni", required: false });
    expect(added("sends_to", "gianni", true)).toEqual({ id: "r7", subject: "anna", verb: "sends_to", object: "gianni" });
    // On a verb that is not a choice, `required` is not said at all.
    expect(added("waits_for", "gianni", false)).toEqual({ id: "r7", subject: "anna", verb: "waits_for", object: "gianni" });
  });

  it("reorders a sentence within its slot, leaving the other slots and the other agents where they are", () => {
    const extra = addRelation(addRelation(addRelation(demoWorkflow, "anna", "sends_to", "gianni"), "anna", "uses_tool", "calculator"), "anna", "uses_tool", "web_search");
    const order = (workflow: Workflow) => workflow.relations.filter((relation) => relation.subject === "anna").map((relation) => relation.verb + (relation.object ?? ""));
    expect(order(extra)).toEqual(["is_entry", "sends_toluca", "sends_togianni", "uses_toolcalculator", "uses_toolweb_search"]);
    const gianni = extra.relations.find((relation) => relation.subject === "anna" && relation.object === "gianni")!;
    const moved = moveRelation(extra, gianni.id, -1);
    expect(order(moved)).toEqual(["is_entry", "sends_togianni", "sends_toluca", "uses_toolcalculator", "uses_toolweb_search"]);
    expect(moved.relations.filter((relation) => relation.subject !== "anna")).toEqual(extra.relations.filter((relation) => relation.subject !== "anna"));
    // The last of what goes out cannot go later: what comes after it is in another slot.
    expect(moveRelation(extra, gianni.id, 1)).toBe(extra);
    // Nor can the first of what it consults go earlier, past what goes out.
    const calculator = extra.relations.find((relation) => relation.object === "calculator")!;
    expect(moveRelation(extra, calculator.id, -1)).toBe(extra);
    expect(order(moveRelation(extra, calculator.id, 1))).toEqual(["is_entry", "sends_toluca", "sends_togianni", "uses_toolweb_search", "uses_toolcalculator"]);
    // Being the entry is alone in its slot.
    expect(moveRelation(extra, "r1", -1)).toBe(extra);
    expect(moveRelation(extra, "r1", 1)).toBe(extra);
    expect(moveRelation(extra, "nope", 1)).toBe(extra);
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
