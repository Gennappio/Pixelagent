import { toolLabel, type Agent, type Relation, type ToolDescription, type Verb, type Workflow } from "./workflow";

// The verbs, and what can be read off a workflow's relations. Pure, and the one place the
// interface learns what an agent does: the layout, the graph, the editor and the inspector
// all ask here.

export type ObjectKind = "agent" | "tool" | "table";

/**
 * A character is one task with three slots, and every verb belongs to one of them: what
 * arrives starts a turn, what it consults is gathered while it works, what goes out is
 * where its sheet and its words go when the turn ends.
 */
export type Slot = "arrives" | "consults" | "goes_out";

export const SLOTS: { slot: Slot; title: string; about: string }[] = [
  { slot: "arrives", title: "Arrives", about: "What starts a turn, or lies on the desk when it starts." },
  { slot: "consults", title: "Consults", about: "What it gathers, or may gather, while it works." },
  { slot: "goes_out", title: "Goes out", about: "Where its sheet and its words go when the turn ends." },
];

export interface VerbInfo {
  verb: Verb;
  slot: Slot;
  /** What the object must be. Null: the verb takes none. */
  objectKind: ObjectKind | null;
  /** How it reads between subject and object: “Anna hands to Luca”. */
  phrase: string;
  /**
   * For the verbs that either always happen or are left to the agent: which of the two
   * when a relation does not say. Undefined: `required` means nothing on this verb.
   */
  requiredByDefault?: boolean;
  /** What it means, for whoever is choosing it. */
  meaning: string;
}

/**
 * The closed catalog, slot by slot. Each verb has execution semantics in the server's
 * runtime, a rule in the VisualEventMapper and a sentence in the transcript; one missing
 * any of those does not belong here. The phrases are the server's
 * (workflow/relations.py), word for word.
 */
export const VERBS: VerbInfo[] = [
  { verb: "is_entry", slot: "arrives", objectKind: null, phrase: "is the entry", meaning: "It receives the task of the run, as its first sheet." },
  { verb: "waits_for", slot: "arrives", objectKind: "agent", phrase: "waits for", meaning: "It starts only once that agent, and everyone else it waits for, has handed it something." },
  { verb: "takes_from_table", slot: "arrives", objectKind: "table", phrase: "takes from", meaning: "It takes one sheet per turn from that pile, for as long as there are any." },
  { verb: "reads_table", slot: "consults", objectKind: "table", phrase: "reads", meaning: "What is on that table is put in front of it before it starts thinking." },
  { verb: "uses_tool", slot: "consults", objectKind: "tool", phrase: "can use", requiredByDefault: false, meaning: "The tool is its to call while it works, if it chooses." },
  { verb: "sends_to", slot: "goes_out", objectKind: "agent", phrase: "hands to", requiredByDefault: true, meaning: "When its turn ends it says something to that agent and hands over its sheet, if it has one." },
  { verb: "writes_table", slot: "goes_out", objectKind: "table", phrase: "writes on", requiredByDefault: true, meaning: "Its sheet is left on that table." },
  { verb: "is_exit", slot: "goes_out", objectKind: null, phrase: "is the exit", meaning: "The last sheet it produces is the result of the run." },
];

/** How a tool reads when the agent does not choose it: the runtime fetches it before the agent thinks. */
export const CONSULTS_FIRST = "consults first";
export const CONSULTS_FIRST_MEANING = "The tool is called for it, with what arrived, before it starts thinking. It does not decide.";

/** One way of saying a verb: uses_tool has two, the others one. */
export interface Phrase {
  key: string;
  verb: Verb;
  phrase: string;
  meaning: string;
  /** Set when the phrase says something other than the verb's default. */
  required?: boolean;
}

/** Everything that can be said in a slot, in catalog order: what the editor offers to add there. */
export function phrasesIn(slot: Slot): Phrase[] {
  return VERBS.filter((info) => info.slot === slot).flatMap((info): Phrase[] => {
    const plain = { key: info.verb, verb: info.verb, phrase: info.phrase, meaning: info.meaning };
    return info.verb === "uses_tool"
      ? [plain, { key: "uses_tool:first", verb: info.verb, phrase: CONSULTS_FIRST, meaning: CONSULTS_FIRST_MEANING, required: true }]
      : [plain];
  });
}

export function verbInfo(verb: Verb): VerbInfo {
  return VERBS.find((info) => info.verb === verb)!;
}

/** Whether the verb can either always happen or be left to the agent. */
export function isChoice(verb: Verb): boolean {
  return verbInfo(verb).requiredByDefault !== undefined;
}

/** Whether the runtime does it, as opposed to the agent choosing it turn by turn. */
export function isRequired(relation: Relation): boolean {
  const byDefault = verbInfo(relation.verb).requiredByDefault;
  return byDefault === undefined ? true : (relation.required ?? byDefault);
}

/** The verb as this relation says it: a tool reads differently when it is consulted first. */
export function phraseOf(relation: Relation): string {
  return relation.verb === "uses_tool" && isRequired(relation) ? CONSULTS_FIRST : verbInfo(relation.verb).phrase;
}

export function relationsOf(workflow: Workflow, agentId: string, verb?: Verb): Relation[] {
  return workflow.relations.filter((relation) => relation.subject === agentId && (verb === undefined || relation.verb === verb));
}

/** An agent's sentences in one of its three slots, in the order they are written. */
export function slotOf(workflow: Workflow, agentId: string, slot: Slot): Relation[] {
  return relationsOf(workflow, agentId).filter((relation) => verbInfo(relation.verb).slot === slot);
}

/**
 * The hand-offs that arrive from others. They belong to what arrives for this agent, and
 * are said, and edited, on the sender.
 */
export function handedBy(workflow: Workflow, agentId: string): Relation[] {
  return workflow.relations.filter((relation) => relation.verb === "sends_to" && relation.object === agentId);
}

/** The tools an agent has to do with, in the order its relations name them. */
export function toolsOf(workflow: Workflow, agentId: string): string[] {
  return relationsOf(workflow, agentId, "uses_tool").flatMap((relation) => (relation.object ? [relation.object] : []));
}

/** Every tool some agent has to do with, each once, in the order the relations first name it. */
export function toolsInUse(workflow: Workflow): string[] {
  return [...new Set(workflow.relations.flatMap((relation) => (relation.verb === "uses_tool" && relation.object ? [relation.object] : [])))];
}

/** Whether an agent can be told to consult this tool first. Only the server knows: a tool it did not list cannot. */
export function canConsultFirst(tools: readonly ToolDescription[], name: string | undefined): boolean {
  return tools.some((tool) => tool.name === name && tool.consultable === true);
}

function only(workflow: Workflow, verb: Verb): Agent | undefined {
  const subject = workflow.relations.find((relation) => relation.verb === verb)?.subject;
  return workflow.agents.find((agent) => agent.id === subject);
}

/** The agent that receives the task, if the workflow says which. */
export function entryOf(workflow: Workflow): Agent | undefined {
  return only(workflow, "is_entry");
}

/** The agent whose sheet is the result, if the workflow says which. */
export function exitOf(workflow: Workflow): Agent | undefined {
  return only(workflow, "is_exit");
}

/** What a relation's object is called: an agent's or a table's name, or a tool's own name. */
export function objectName(workflow: Workflow, relation: Relation): string {
  const id = relation.object;
  if (!id) return "";
  const kind = verbInfo(relation.verb).objectKind;
  if (kind === "agent") return workflow.agents.find((agent) => agent.id === id)?.name ?? id;
  if (kind === "table") return workflow.tables.find((table) => table.id === id)?.name || id;
  return id;
}

/** The relation in words, e.g. “Anna hands to Luca”. */
export function sentence(workflow: Workflow, relation: Relation): string {
  const subject = workflow.agents.find((agent) => agent.id === relation.subject)?.name ?? relation.subject;
  const target = objectName(workflow, relation);
  return target ? `${subject} ${phraseOf(relation)} ${target}` : `${subject} ${phraseOf(relation)}`;
}

/** Whether sheets handed along this relation can come back round to its subject. */
export function closesCycle(workflow: Workflow, relation: Relation): boolean {
  if (relation.verb !== "sends_to" || !relation.object) return false;
  const reached = new Set<string>();
  const frontier = [relation.object];
  while (frontier.length > 0) {
    const current = frontier.pop()!;
    if (current === relation.subject) return true;
    if (reached.has(current)) continue;
    reached.add(current);
    for (const step of relationsOf(workflow, current, "sends_to")) if (step.object) frontier.push(step.object);
  }
  return false;
}

/**
 * What a run cannot do without and a saved workflow may still lack, in words; empty when it
 * can run. `tools` are the ones the server listed: with none known, nothing is said about them.
 */
export function whyNotRunnable(workflow: Workflow, tools: readonly ToolDescription[] = []): string[] {
  const missing: string[] = [];
  if (workflow.agents.length === 0) return ["The office has no agents yet."];
  if (!entryOf(workflow)) missing.push("No agent is the entry: pick the one that receives the task.");
  if (!exitOf(workflow)) missing.push("No agent is the exit: pick the one whose sheet is the result.");
  if (tools.length === 0) return missing;
  for (const relation of workflow.relations) {
    if (relation.verb !== "uses_tool" || !relation.object) continue;
    const agent = workflow.agents.find((candidate) => candidate.id === relation.subject)?.name ?? relation.subject;
    if (!tools.some((tool) => tool.name === relation.object)) {
      missing.push(`${agent} is given the tool ${toolLabel(relation.object)}, which the server does not have.`);
    } else if (isRequired(relation) && !canConsultFirst(tools, relation.object)) {
      missing.push(`${agent} consults ${toolLabel(relation.object)} first, but only a tool with one text argument can be consulted first: let ${agent} use it instead.`);
    }
  }
  return missing;
}
