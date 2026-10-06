import { describe, expect, it } from "vitest";
import { phrasesIn, sentence, SLOTS, verbInfo } from "../protocol/relations";
import type { ToolDescription, Workflow } from "../protocol/workflow";
import { demoWorkflow, parallelWorkflow, tablesWorkflow } from "../testing/demoRun";
import { canPick, describePending, hasTargets, pick, pickTargets, type PendingSentence, type Picked } from "./picking";
import { canRelate } from "./workflowEdits";

/** The server's three tools, as GET /tools lists them. */
const TOOLS: ToolDescription[] = [
  { name: "web_search", description: "", schema: {}, consultable: true },
  { name: "send_email", description: "", schema: {}, consultable: false },
  { name: "calculator", description: "", schema: {}, consultable: true },
];

/** Every sentence that could be pending on every agent: each phrase of each slot. */
function everyPending(workflow: Workflow): PendingSentence[] {
  return workflow.agents.flatMap((agent) =>
    SLOTS.flatMap(({ slot }) => phrasesIn(slot))
      .filter((phrase) => verbInfo(phrase.verb).objectKind !== null)
      .map((phrase) => ({ subject: agent.id, verb: phrase.verb, ...(phrase.required ? { required: true } : {}) })),
  );
}

/** Everything in the office that could be clicked, and every tool that could be chosen. */
function everythingClickable(workflow: Workflow): Picked[] {
  return [
    ...workflow.agents.map((agent) => ({ kind: "agent" as const, id: agent.id })),
    ...workflow.tables.map((table) => ({ kind: "table" as const, id: table.id })),
    ...TOOLS.map((tool) => ({ kind: "tool" as const, id: tool.name })),
  ];
}

const say = (workflow: Workflow) => workflow.relations.map((relation) => sentence(workflow, relation));

/** The demo's three characters with nothing said yet: no station stands anywhere. */
const unwired: Workflow = { ...demoWorkflow, relations: [] };
/** The demo without its mailbox: the email is a tool the office does not have yet. */
const noMailbox: Workflow = { ...demoWorkflow, relations: demoWorkflow.relations.filter((relation) => relation.object !== "send_email") };

describe("pickTargets", () => {
  it("lights exactly what the edit would accept, for every sentence that could be pending", () => {
    for (const workflow of [demoWorkflow, tablesWorkflow, parallelWorkflow, unwired, noMailbox]) {
      for (const pending of everyPending(workflow)) {
        const targets = pickTargets(workflow, pending, TOOLS);
        const lit = new Set([
          ...targets.agents.map((id) => `agent:${id}`),
          ...targets.tables.map((id) => `table:${id}`),
          ...targets.stations.map((id) => `tool:${id}`),
          ...targets.tools.map((tool) => `tool:${tool.name}`),
        ]);
        for (const thing of everythingClickable(workflow)) {
          const accepted = verbInfo(pending.verb).objectKind === thing.kind && canRelate(workflow, pending.subject, pending.verb, thing.id, { required: pending.required, tools: TOOLS });
          expect(lit.has(`${thing.kind}:${thing.id}`), `${pending.subject} ${pending.verb}${pending.required ? " (first)" : ""} → ${thing.kind} ${thing.id}`).toBe(accepted);
          // And a click on it is taken, or not, by the same rule.
          expect(canPick(workflow, pending, thing, TOOLS)).toBe(accepted);
          expect(pick(workflow, pending, thing, TOOLS) !== workflow).toBe(accepted);
        }
      }
    }
  });

  it("never lights the subject itself", () => {
    for (const workflow of [demoWorkflow, tablesWorkflow, parallelWorkflow]) {
      for (const pending of everyPending(workflow)) expect(pickTargets(workflow, pending, TOOLS).agents).not.toContain(pending.subject);
    }
  });

  it("lights characters for handing to and waiting for, minus those already said", () => {
    expect(pickTargets(demoWorkflow, { subject: "anna", verb: "sends_to" }, TOOLS)).toEqual({ agents: ["gianni"], tables: [], stations: [], tools: [] });
    expect(pickTargets(demoWorkflow, { subject: "anna", verb: "waits_for" }, TOOLS).agents).toEqual(["luca", "gianni"]);
  });

  it("lights tables of the right kind for reading, writing and taking", () => {
    const tables = (verb: PendingSentence["verb"]) => pickTargets(tablesWorkflow, { subject: "anna", verb }, TOOLS).tables;
    expect(tables("reads_table")).toEqual(["board"]);
    expect(tables("takes_from_table")).toEqual(["todo", "done"]);
    expect(tables("writes_table")).toEqual(["todo", "done", "board"]);
    // Luca already takes from one pile and writes on two tables.
    expect(pickTargets(tablesWorkflow, { subject: "luca", verb: "takes_from_table" }, TOOLS).tables).toEqual(["done"]);
    expect(pickTargets(tablesWorkflow, { subject: "luca", verb: "writes_table" }, TOOLS).tables).toEqual(["todo"]);
  });

  it("lights the stations that stand in the room, and lists the tools that have none yet", () => {
    // The demo has a computer and a mailbox; nobody has the calculator.
    const forAnna = pickTargets(demoWorkflow, { subject: "anna", verb: "uses_tool" }, TOOLS);
    expect(forAnna.stations).toEqual(["web_search", "send_email"]);
    expect(forAnna.tools.map((tool) => tool.name)).toEqual(["calculator"]);
    // Luca has the computer already.
    const forLuca = pickTargets(demoWorkflow, { subject: "luca", verb: "uses_tool" }, TOOLS);
    expect(forLuca.stations).toEqual(["send_email"]);
    expect(forLuca.tools.map((tool) => tool.name)).toEqual(["calculator"]);
  });

  it("offers for consulting first only the tools that can be", () => {
    const first = pickTargets(demoWorkflow, { subject: "anna", verb: "uses_tool", required: true }, TOOLS);
    expect(first.stations).toEqual(["web_search"]); // the mailbox stands there, and stays dim
    expect(first.tools.map((tool) => tool.name)).toEqual(["calculator"]);
    // A tool that cannot be is not in the list either, station or no station.
    expect(pickTargets(noMailbox, { subject: "anna", verb: "uses_tool", required: true }, TOOLS).tools.map((tool) => tool.name)).toEqual(["calculator"]);
    expect(pickTargets(unwired, { subject: "anna", verb: "uses_tool", required: true }, TOOLS)).toMatchObject({ stations: [] });
    expect(pickTargets(unwired, { subject: "anna", verb: "uses_tool", required: true }, TOOLS).tools.map((tool) => tool.name)).toEqual(["web_search", "calculator"]);
    expect(pickTargets(unwired, { subject: "anna", verb: "uses_tool" }, TOOLS).tools.map((tool) => tool.name)).toEqual(["web_search", "send_email", "calculator"]);
    // Without the server's list no tool is known at all.
    expect(hasTargets(pickTargets(demoWorkflow, { subject: "anna", verb: "uses_tool" }, []))).toBe(false);
  });

  it("says when there is nothing to pick, so the verb is not offered", () => {
    expect(hasTargets(pickTargets(demoWorkflow, { subject: "anna", verb: "reads_table" }, TOOLS))).toBe(false);
    expect(hasTargets(pickTargets(demoWorkflow, { subject: "anna", verb: "sends_to" }, TOOLS))).toBe(true);
    const alone: Workflow = { ...demoWorkflow, agents: demoWorkflow.agents.slice(0, 1), relations: [] };
    expect(hasTargets(pickTargets(alone, { subject: "anna", verb: "sends_to" }, TOOLS))).toBe(false);
  });
});

describe("pick", () => {
  it("finishes the sentence with what was clicked", () => {
    const handed = pick(demoWorkflow, { subject: "anna", verb: "sends_to" }, { kind: "agent", id: "gianni" }, TOOLS);
    expect(say(handed)).toContain("Anna hands to Gianni");
    expect(handed.relations).toHaveLength(demoWorkflow.relations.length + 1);
  });

  it("keeps how it was said: a tool picked to be consulted first is consulted first", () => {
    const first = pick(demoWorkflow, { subject: "anna", verb: "uses_tool", required: true }, { kind: "tool", id: "calculator" }, TOOLS);
    expect(say(first)).toContain("Anna consults first calculator");
    const used = pick(demoWorkflow, { subject: "anna", verb: "uses_tool" }, { kind: "tool", id: "calculator" }, TOOLS);
    expect(say(used)).toContain("Anna can use calculator");
    expect(used.relations.at(2)).toEqual({ id: "r7", subject: "anna", verb: "uses_tool", object: "calculator" });
  });

  it("takes no notice of a click on the wrong kind of thing, or on what stays dim", () => {
    const handing: PendingSentence = { subject: "anna", verb: "sends_to" };
    // A station while a character is wanted, even one that shares a name with nobody.
    expect(pick(demoWorkflow, handing, { kind: "tool", id: "web_search" }, TOOLS)).toBe(demoWorkflow);
    // Luca: she hands to him already. Anna: herself.
    expect(pick(demoWorkflow, handing, { kind: "agent", id: "luca" }, TOOLS)).toBe(demoWorkflow);
    expect(pick(demoWorkflow, handing, { kind: "agent", id: "anna" }, TOOLS)).toBe(demoWorkflow);
    // The mailbox cannot be consulted first.
    expect(pick(demoWorkflow, { subject: "anna", verb: "uses_tool", required: true }, { kind: "tool", id: "send_email" }, TOOLS)).toBe(demoWorkflow);
    // An agent whose id happens to be a table's name is still an agent.
    expect(canPick(tablesWorkflow, { subject: "anna", verb: "reads_table" }, { kind: "agent", id: "board" }, TOOLS)).toBe(false);
  });

  it("is the only thing that touches the workflow: looking at what could be picked changes nothing", () => {
    const frozen = JSON.stringify(tablesWorkflow);
    for (const pending of everyPending(tablesWorkflow)) {
      pickTargets(tablesWorkflow, pending, TOOLS);
      describePending(tablesWorkflow, pending);
    }
    expect(JSON.stringify(tablesWorkflow)).toBe(frozen);
  });
});

describe("describePending", () => {
  it("says the sentence as far as it goes, and what is still to pick", () => {
    expect(describePending(demoWorkflow, { subject: "anna", verb: "sends_to" })).toEqual({ said: "Anna hands to …", missing: "a character" });
    expect(describePending(demoWorkflow, { subject: "luca", verb: "waits_for" })).toEqual({ said: "Luca waits for …", missing: "a character" });
    expect(describePending(demoWorkflow, { subject: "luca", verb: "uses_tool" })).toEqual({ said: "Luca can use …", missing: "a tool" });
    expect(describePending(demoWorkflow, { subject: "luca", verb: "uses_tool", required: true })).toEqual({ said: "Luca consults first …", missing: "a tool" });
    expect(describePending(tablesWorkflow, { subject: "luca", verb: "takes_from_table" }).missing).toBe("a pile");
    expect(describePending(tablesWorkflow, { subject: "luca", verb: "reads_table" }).missing).toBe("a shared table");
    expect(describePending(tablesWorkflow, { subject: "luca", verb: "writes_table" }).missing).toBe("a table");
  });
});
