import { describe, expect, it } from "vitest";
import { demoWorkflow, parallelWorkflow, tablesWorkflow } from "../testing/demoRun";
import {
  canConsultFirst,
  closesCycle,
  entryOf,
  exitOf,
  handedBy,
  isChoice,
  isRequired,
  objectName,
  phraseOf,
  phrasesIn,
  relationsOf,
  sentence,
  slotOf,
  SLOTS,
  toolsInUse,
  toolsOf,
  verbInfo,
  VERBS,
  whyNotRunnable,
} from "./relations";
import type { Relation, ToolDescription, Workflow } from "./workflow";

/** The server's three tools, as GET /tools lists them. */
const TOOLS: ToolDescription[] = [
  { name: "web_search", description: "", schema: {}, consultable: true },
  { name: "send_email", description: "", schema: {}, consultable: false },
  { name: "calculator", description: "", schema: {}, consultable: true },
];

describe("the verb catalog", () => {
  it("has the eight verbs, each with a phrase and a meaning", () => {
    expect(VERBS.map((info) => info.verb).sort()).toEqual(["is_entry", "is_exit", "reads_table", "sends_to", "takes_from_table", "uses_tool", "waits_for", "writes_table"]);
    for (const info of VERBS) {
      expect(info.phrase.length).toBeGreaterThan(3);
      expect(info.meaning.endsWith(".")).toBe(true);
    }
  });

  it("says the verbs with the words the server uses", () => {
    // server/workflow/relations.py: PHRASE and CONSULTS_FIRST, word for word.
    expect(Object.fromEntries(VERBS.map((info) => [info.verb, info.phrase]))).toEqual({
      sends_to: "hands to",
      waits_for: "waits for",
      uses_tool: "can use",
      reads_table: "reads",
      writes_table: "writes on",
      takes_from_table: "takes from",
      is_entry: "is the entry",
      is_exit: "is the exit",
    });
    expect(phraseOf({ id: "r", subject: "a", verb: "uses_tool", object: "t", required: true })).toBe("consults first");
  });

  it("puts every verb in one of the three slots of a character", () => {
    const bySlot = (slot: (typeof SLOTS)[number]["slot"]) => VERBS.filter((info) => info.slot === slot).map((info) => info.verb);
    expect(SLOTS.map((entry) => entry.slot)).toEqual(["arrives", "consults", "goes_out"]);
    expect(bySlot("arrives")).toEqual(["is_entry", "waits_for", "takes_from_table"]);
    expect(bySlot("consults")).toEqual(["reads_table", "uses_tool"]);
    expect(bySlot("goes_out")).toEqual(["sends_to", "writes_table", "is_exit"]);
  });

  it("lets handing over, writing and using a tool be either required or left to the agent, each with its own default", () => {
    expect(VERBS.filter((info) => isChoice(info.verb)).map((info) => [info.verb, info.requiredByDefault])).toEqual([
      ["uses_tool", false],
      ["sends_to", true],
      ["writes_table", true],
    ]);
  });

  it("offers, slot by slot, everything that can be said there: a tool in two ways", () => {
    expect(phrasesIn("arrives").map((entry) => entry.phrase)).toEqual(["is the entry", "waits for", "takes from"]);
    expect(phrasesIn("consults").map((entry) => [entry.phrase, entry.verb, entry.required])).toEqual([
      ["reads", "reads_table", undefined],
      ["can use", "uses_tool", undefined],
      ["consults first", "uses_tool", true],
    ]);
    expect(phrasesIn("goes_out").map((entry) => entry.phrase)).toEqual(["hands to", "writes on", "is the exit"]);
    const keys = SLOTS.flatMap((entry) => phrasesIn(entry.slot).map((phrase) => phrase.key));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("knows what each verb applies to", () => {
    expect(Object.fromEntries(VERBS.map((info) => [info.verb, info.objectKind]))).toEqual({
      sends_to: "agent",
      waits_for: "agent",
      uses_tool: "tool",
      reads_table: "table",
      writes_table: "table",
      takes_from_table: "table",
      is_entry: null,
      is_exit: null,
    });
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
      "Anna hands to Luca",
      "Luca can use web_search",
      "Luca hands to Gianni",
      "Gianni can use send_email",
      "Gianni is the exit",
    ]);
    // On the supplier board nobody decides to search: the workflow says the search comes first.
    expect(say(tablesWorkflow)).toContain("Luca consults first web_search");
    expect(say(tablesWorkflow)).toContain("Gianni can use send_email");
    expect(say(tablesWorkflow)).toContain("Luca takes from To research");
    expect(say(tablesWorkflow)).toContain("Gianni reads Board");
    expect(say(parallelWorkflow)).toContain("Marta waits for Luca");
  });

  it("names the object of a relation the way it is called", () => {
    const takes = tablesWorkflow.relations.find((relation) => relation.verb === "takes_from_table")!;
    expect(objectName(tablesWorkflow, takes)).toBe("To research");
    expect(objectName(demoWorkflow, demoWorkflow.relations[0])).toBe("");
  });

  it("reads required against each verb's own default", () => {
    const relation = (verb: Relation["verb"], required?: boolean): Relation => ({ id: "r", subject: "a", verb, object: "b", ...(required === undefined ? {} : { required }) });
    // Handing over and writing happen unless left to the agent.
    expect([isRequired(relation("sends_to")), isRequired(relation("sends_to", false))]).toEqual([true, false]);
    expect([isRequired(relation("writes_table")), isRequired(relation("writes_table", false))]).toEqual([true, false]);
    // A tool is the agent's to call unless it is consulted first.
    expect([isRequired(relation("uses_tool")), isRequired(relation("uses_tool", true))]).toEqual([false, true]);
    // On the verbs that are not a choice it means nothing, whatever a file says.
    expect([isRequired(relation("waits_for", false)), isRequired(relation("reads_table", false)), isRequired(relation("is_entry", false))]).toEqual([true, true, true]);
    expect(relationsOf(demoWorkflow, "luca").map((relation) => relation.verb)).toEqual(["uses_tool", "sends_to"]);
    expect(verbInfo("waits_for").phrase).toBe("waits for");
  });

  it("sorts an agent's sentences into its three slots, and lists who hands to it", () => {
    const slots = (workflow: Workflow, agentId: string) => SLOTS.map((entry) => slotOf(workflow, agentId, entry.slot).map((relation) => sentence(workflow, relation)));
    expect(slots(tablesWorkflow, "luca")).toEqual([
      ["Luca takes from To research"],
      ["Luca consults first web_search"],
      ["Luca writes on Researched", "Luca writes on Board"],
    ]);
    expect(slots(parallelWorkflow, "marta")).toEqual([["Marta waits for Luca", "Marta waits for Gianni"], [], ["Marta is the exit"]]);
    expect(slots(demoWorkflow, "anna")).toEqual([["Anna is the entry"], [], ["Anna hands to Luca"]]);
    // Every sentence of an agent is in exactly one slot.
    for (const workflow of [demoWorkflow, tablesWorkflow, parallelWorkflow]) {
      for (const agent of workflow.agents) expect(slots(workflow, agent.id).flat().sort()).toEqual(relationsOf(workflow, agent.id).map((relation) => sentence(workflow, relation)).sort());
    }
    // What arrives from others is said on the sender.
    expect(handedBy(parallelWorkflow, "marta").map((relation) => sentence(parallelWorkflow, relation))).toEqual(["Luca hands to Marta", "Gianni hands to Marta"]);
    expect(handedBy(demoWorkflow, "anna")).toEqual([]);
  });

  it("knows which tools can be consulted first from what the server lists, and nothing without it", () => {
    expect(TOOLS.map((tool) => canConsultFirst(TOOLS, tool.name))).toEqual([true, false, true]);
    expect(canConsultFirst(TOOLS, "teleporter")).toBe(false);
    expect(canConsultFirst([], "web_search")).toBe(false);
    expect(canConsultFirst([{ name: "old", description: "", schema: {} }], "old")).toBe(false);
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

  it("says, as the server would, when a tool is consulted first that cannot be, or is not there at all", () => {
    for (const workflow of [demoWorkflow, tablesWorkflow, parallelWorkflow]) expect(whyNotRunnable(workflow, TOOLS)).toEqual([]);
    const first = (tool: string): Workflow => ({ ...demoWorkflow, relations: [...demoWorkflow.relations, { id: "r9", subject: "anna", verb: "uses_tool", object: tool, required: true }] });
    expect(whyNotRunnable(first("calculator"), TOOLS)).toEqual([]);
    expect(whyNotRunnable(first("send_email"), TOOLS)).toEqual([
      "Anna consults Send Email first, but only a tool with one text argument can be consulted first: let Anna use it instead.",
    ]);
    expect(whyNotRunnable(first("teleporter"), TOOLS)).toEqual(["Anna is given the tool Teleporter, which the server does not have."]);
    // With no list from the server there is nothing to check against.
    expect(whyNotRunnable(first("send_email"))).toEqual([]);
  });
});
