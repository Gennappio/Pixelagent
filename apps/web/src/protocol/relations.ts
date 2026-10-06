import type { Agent, Relation, Verb, Workflow } from "./workflow";

// The verbs, and what can be read off a workflow's relations. Pure, and the one place the
// interface learns what an agent does: the layout, the graph, the editor and the inspector
// all ask here.

export type ObjectKind = "agent" | "tool" | "table";

export interface VerbInfo {
  verb: Verb;
  /** What the object must be. Null: the verb takes none. */
  objectKind: ObjectKind | null;
  /** How it reads between subject and object: “Anna hands a sheet to Luca”. */
  phrase: string;
  /** Whether it can be left to the agent, turn by turn, instead of always happening. */
  optional: boolean;
  /** What it means, for whoever is choosing it. */
  meaning: string;
}

/**
 * The closed catalog. Each verb has execution semantics in the server's runtime, a rule in
 * the VisualEventMapper and a sentence in the transcript; one missing any of those does
 * not belong here. The phrases are the server's (workflow/relations.py), word for word.
 */
export const VERBS: VerbInfo[] = [
  { verb: "sends_to", objectKind: "agent", phrase: "hands a sheet to", optional: true, meaning: "When its turn ends, its output goes to that agent." },
  { verb: "waits_for", objectKind: "agent", phrase: "waits for", optional: false, meaning: "It starts only once it has a sheet from that agent, and from everyone else it waits for." },
  { verb: "uses_tool", objectKind: "tool", phrase: "can use", optional: false, meaning: "The tool is available to it during its turn." },
  { verb: "reads_table", objectKind: "table", phrase: "reads", optional: false, meaning: "At the start of its turn it reads what is on that table." },
  { verb: "writes_table", objectKind: "table", phrase: "writes on", optional: true, meaning: "Its output is left on that table." },
  { verb: "takes_from_table", objectKind: "table", phrase: "takes from", optional: false, meaning: "It takes one sheet per turn from that pile, for as long as there are any." },
  { verb: "is_entry", objectKind: null, phrase: "is the entry", optional: false, meaning: "It receives the task of the run." },
  { verb: "is_exit", objectKind: null, phrase: "is the exit", optional: false, meaning: "Its last output is the result of the run." },
];

export function verbInfo(verb: Verb): VerbInfo {
  return VERBS.find((info) => info.verb === verb)!;
}

/** A relation happens every time unless it says otherwise. */
export function isRequired(relation: Relation): boolean {
  return relation.required !== false;
}

export function relationsOf(workflow: Workflow, agentId: string, verb?: Verb): Relation[] {
  return workflow.relations.filter((relation) => relation.subject === agentId && (verb === undefined || relation.verb === verb));
}

/** The tools an agent can use, in the order its relations name them. */
export function toolsOf(workflow: Workflow, agentId: string): string[] {
  return relationsOf(workflow, agentId, "uses_tool").flatMap((relation) => (relation.object ? [relation.object] : []));
}

/** Every tool some agent can use, each once, in the order the relations first name it. */
export function toolsInUse(workflow: Workflow): string[] {
  return [...new Set(workflow.relations.flatMap((relation) => (relation.verb === "uses_tool" && relation.object ? [relation.object] : [])))];
}

function only(workflow: Workflow, verb: Verb): Agent | undefined {
  const subject = workflow.relations.find((relation) => relation.verb === verb)?.subject;
  return workflow.agents.find((agent) => agent.id === subject);
}

/** The agent that receives the task, if the workflow says which. */
export function entryOf(workflow: Workflow): Agent | undefined {
  return only(workflow, "is_entry");
}

/** The agent whose output is the result, if the workflow says which. */
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

/** The relation in words, e.g. “Anna hands a sheet to Luca”. */
export function sentence(workflow: Workflow, relation: Relation): string {
  const subject = workflow.agents.find((agent) => agent.id === relation.subject)?.name ?? relation.subject;
  const target = objectName(workflow, relation);
  return target ? `${subject} ${verbInfo(relation.verb).phrase} ${target}` : `${subject} ${verbInfo(relation.verb).phrase}`;
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

/** What a run cannot do without and a saved workflow may still lack, in words; empty when it can run. */
export function whyNotRunnable(workflow: Workflow): string[] {
  const missing: string[] = [];
  if (workflow.agents.length === 0) return ["The office has no agents yet."];
  if (!entryOf(workflow)) missing.push("No agent is the entry: pick the one that receives the task.");
  if (!exitOf(workflow)) missing.push("No agent is the exit: pick the one whose output is the result.");
  return missing;
}
