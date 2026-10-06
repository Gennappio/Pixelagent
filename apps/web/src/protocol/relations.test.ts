import { describe, expect, it } from "vitest";
import { demoWorkflow, parallelWorkflow, tablesWorkflow } from "../testing/demoRun";
import { closesCycle, entryOf, exitOf, isRequired, objectName, relationsOf, sentence, toolsInUse, toolsOf, verbInfo, VERBS, whyNotRunnable } from "./relations";
import type { Workflow } from "./workflow";

describe("the verb catalog", () => {
  it("has the eight verbs, each with a phrase and a meaning", () => {
    expect(VERBS.map((info) => info.verb)).toEqual(["sends_to", "waits_for", "uses_tool", "reads_table", "writes_table", "takes_from_table", "is_entry", "is_exit"]);
    for (const info of VERBS) {
      expect(info.phrase.length).toBeGreaterThan(3);
      expect(info.meaning.endsWith(".")).toBe(true);
    }
  });

  it("lets only handing over and writing be left to the agent", () => {
    expect(VERBS.filter((info) => info.optional).map((info) => info.verb)).toEqual(["sends_to", "writes_table"]);
  });

  it("knows what each verb applies to", () => {
    expect(VERBS.map((info) => info.objectKind)).toEqual(["agent", "agent", "tool", "table", "table", "table", null, null]);
  });
});

describe("reading a workflow's relations", () => {
  it("finds who receives the task and who delivers the result", () => {
    expect([entryOf(demoWorkflow)?.id, exitOf(demoWorkflow)?.id]).toEqual(["anna", "gianni"]);
    expect([entryOf(parallelWorkflow)?.id, exitOf(parallelWorkflow)?.id]).toEqual(["anna", "marta"]);
    expect(entryOf({ ...demoWorkflow, relations: [] })).toBeUndefined();
  });

  it("lists an agent's tools, and every tool in use once", () => {
    expect(toolsOf(demoWorkflow, "luca")).toEqual(["web_search"]);
    expect(toolsOf(demoWorkflow, "anna")).toEqual([]);
    expect(toolsInUse(demoWorkflow)).toEqual(["web_search", "send_email"]);
    const shared: Workflow = { ...demoWorkflow, relations: [...demoWorkflow.relations, { id: "r9", subject: "anna", verb: "uses_tool", object: "web_search" }] };
    expect(toolsInUse(shared)).toEqual(["web_search", "send_email"]);
  });

  it("puts a relation into words", () => {
    const say = (workflow: Workflow) => workflow.relations.map((relation) => sentence(workflow, relation));
    expect(say(demoWorkflow)).toEqual([
      "Anna is the entry",
      "Anna hands a sheet to Luca",
      "Luca can use web_search",
      "Luca hands a sheet to Gianni",
      "Gianni can use send_email",
      "Gianni is the exit",
    ]);
    expect(say(tablesWorkflow)).toContain("Luca takes from To research");
    expect(say(tablesWorkflow)).toContain("Gianni reads Board");
    expect(say(parallelWorkflow)).toContain("Marta waits for Luca");
  });

  it("names the object of a relation the way it is called", () => {
    const takes = tablesWorkflow.relations.find((relation) => relation.verb === "takes_from_table")!;
    expect(objectName(tablesWorkflow, takes)).toBe("To research");
    expect(objectName(demoWorkflow, demoWorkflow.relations[0])).toBe("");
  });

  it("treats a relation as required unless it says otherwise", () => {
    expect(isRequired({ id: "r", subject: "a", verb: "sends_to", object: "b" })).toBe(true);
    expect(isRequired({ id: "r", subject: "a", verb: "sends_to", object: "b", required: false })).toBe(false);
    expect(relationsOf(demoWorkflow, "luca").map((relation) => relation.verb)).toEqual(["uses_tool", "sends_to"]);
    expect(verbInfo("waits_for").phrase).toBe("waits for");
  });

  it("sees when sheets can come back round", () => {
    const loop: Workflow = {
      ...demoWorkflow,
      relations: [
        { id: "r1", subject: "anna", verb: "sends_to", object: "luca" },
        { id: "r2", subject: "luca", verb: "sends_to", object: "gianni" },
        { id: "r3", subject: "gianni", verb: "sends_to", object: "anna" },
        { id: "r4", subject: "gianni", verb: "uses_tool", object: "send_email" },
      ],
    };
    expect(loop.relations.map((relation) => closesCycle(loop, relation))).toEqual([true, true, true, false]);
    expect(demoWorkflow.relations.some((relation) => closesCycle(demoWorkflow, relation))).toBe(false);
  });

  it("says what a workflow still lacks before it can run", () => {
    expect(whyNotRunnable(demoWorkflow)).toEqual([]);
    expect(whyNotRunnable({ ...demoWorkflow, agents: [] })).toEqual(["The office has no agents yet."]);
    const unfinished = whyNotRunnable({ ...demoWorkflow, relations: demoWorkflow.relations.filter((relation) => relation.verb !== "is_exit") });
    expect(unfinished).toHaveLength(1);
    expect(unfinished[0]).toMatch(/No agent is the exit/);
  });
});
