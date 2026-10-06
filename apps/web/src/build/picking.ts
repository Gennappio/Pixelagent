import { canConsultFirst, CONSULTS_FIRST, toolsInUse, verbInfo, type ObjectKind } from "../protocol/relations";
import type { ToolDescription, Verb, Workflow } from "../protocol/workflow";
import { addRelation, canRelate, objectChoices, type Saying } from "./workflowEdits";

// A sentence is added in two moves: say the verb on the character, then pick what it
// applies to in the office. Between the two there is a pending sentence, and this module
// says what it lights: exactly what the edit would accept, so a click never meets a refusal.

/** A sentence that has its subject and its verb, and waits for its object to be picked. */
export interface PendingSentence {
  subject: string;
  verb: Verb;
  /** Said against the verb's default: "consults first" for a tool. */
  required?: boolean;
}

/** What can be clicked in the world, or chosen from the list, to finish a pending sentence. */
export interface PickTargets {
  /** Characters that stay lit. */
  agents: string[];
  /** Tables that stay lit. */
  tables: string[];
  /** Tools whose station stands in the room, and stays lit. */
  stations: string[];
  /** Tools nobody uses yet: they have no station to click, so they are offered in a list. */
  tools: ToolDescription[];
}

export const NO_TARGETS: PickTargets = { agents: [], tables: [], stations: [], tools: [] };

function saying(pending: PendingSentence, tools: readonly ToolDescription[]): Saying {
  return { required: pending.required, tools };
}

/** Everything the pending sentence could end with. `tools` are the ones the server listed. */
export function pickTargets(workflow: Workflow, pending: PendingSentence, tools: readonly ToolDescription[]): PickTargets {
  const kind = verbInfo(pending.verb).objectKind;
  const choices = objectChoices(workflow, pending.subject, pending.verb, saying(pending, tools)).map((choice) => choice.id);
  if (kind === "agent") return { ...NO_TARGETS, agents: choices };
  if (kind === "table") return { ...NO_TARGETS, tables: choices };
  if (kind !== "tool") return NO_TARGETS;
  const standing = new Set(toolsInUse(workflow));
  return {
    ...NO_TARGETS,
    stations: choices.filter((tool) => standing.has(tool)),
    tools: tools.filter((tool) => choices.includes(tool.name) && !standing.has(tool.name)),
  };
}

/** Whether there is anything at all to pick: a verb with nothing to apply to is not worth starting. */
export function hasTargets(targets: PickTargets): boolean {
  return targets.agents.length + targets.tables.length + targets.stations.length + targets.tools.length > 0;
}

/** Something in the office that was clicked while a sentence was pending: a character, a table, or a tool by its station or its name in the list. */
export interface Picked {
  kind: ObjectKind;
  id: string;
}

/** Whether the pending sentence could end with what was clicked. The same answer the edit itself gives. */
export function canPick(workflow: Workflow, pending: PendingSentence, picked: Picked, tools: readonly ToolDescription[]): boolean {
  return verbInfo(pending.verb).objectKind === picked.kind && canRelate(workflow, pending.subject, pending.verb, picked.id, saying(pending, tools));
}

/** The workflow with the pending sentence finished by what was clicked; the same workflow if it cannot be. */
export function pick(workflow: Workflow, pending: PendingSentence, picked: Picked, tools: readonly ToolDescription[]): Workflow {
  if (!canPick(workflow, pending, picked, tools)) return workflow;
  return addRelation(workflow, pending.subject, pending.verb, picked.id, saying(pending, tools));
}

/** The pending sentence as far as it has been said, and what is still to pick: “Anna hands to …”, “a character”. */
export function describePending(workflow: Workflow, pending: PendingSentence): { said: string; missing: string } {
  const subject = workflow.agents.find((agent) => agent.id === pending.subject)?.name ?? pending.subject;
  const info = verbInfo(pending.verb);
  const phrase = pending.verb === "uses_tool" && pending.required ? CONSULTS_FIRST : info.phrase;
  const missing = info.objectKind === "agent" ? "a character" : info.objectKind === "table" ? (pending.verb === "takes_from_table" ? "a pile" : pending.verb === "reads_table" ? "a shared table" : "a table") : "a tool";
  return { said: `${subject} ${phrase} …`, missing };
}

/** Why a tool is, or is not, in the list of a pending "consults first". Shown beside each tool. */
export function consultNote(tools: readonly ToolDescription[], name: string): string {
  return canConsultFirst(tools, name) ? "can be consulted first" : "can only be used";
}

