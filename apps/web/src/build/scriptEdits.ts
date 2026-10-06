import type { AgentScript } from "../protocol/workflow";

// What a scripted agent says and writes, as the configuration form reads and changes it.
// Pure: each edit returns a new script, with nothing left in it that says nothing.

/** What the agent writes: a sheet of its own, nothing at all, or whatever it found or holds. */
export type SheetMode = "default" | "sheet" | "none";

export function sheetMode(script: AgentScript | undefined): SheetMode {
  if (script?.sheet === false) return "none";
  // `message` is how a sheet was scripted before a hand-off had words of its own.
  return script?.sheet || script?.message ? "sheet" : "default";
}

/** The sheet the script writes, as two texts. A script from before revision 3 has only the content. */
export function scriptedSheet(script: AgentScript | undefined): { title: string; content: string } {
  if (script?.sheet) return { title: script.sheet.title ?? "", content: script.sheet.content ?? "" };
  return { title: "", content: script?.message ?? "" };
}

/** Empty lines, an empty title and an empty script are left unsaid. Undefined: nothing is scripted. */
function tidy(script: AgentScript): AgentScript | undefined {
  const next: AgentScript = {};
  if (typeof script.says === "string" && script.says !== "") next.says = script.says;
  if (script.says && typeof script.says === "object") {
    const lines = Object.fromEntries(Object.entries(script.says).filter(([, line]) => line !== ""));
    // A line for each stays a line for each even while every one of them is still empty.
    next.says = lines;
  }
  if (script.sheet === false) next.sheet = false;
  else if (script.sheet) next.sheet = { ...(script.sheet.title ? { title: script.sheet.title } : {}), content: script.sheet.content ?? "" };
  else if (script.message) next.message = script.message;
  return Object.keys(next).length > 0 ? next : undefined;
}

export function setSheetMode(script: AgentScript | undefined, mode: SheetMode): AgentScript | undefined {
  const { sheet: _sheet, message: _message, ...rest } = script ?? {};
  if (mode === "none") return tidy({ ...rest, sheet: false });
  if (mode === "sheet") return tidy({ ...rest, sheet: scriptedSheet(script) });
  return tidy(rest);
}

/** Changes the sheet it writes. An old `message` becomes the sheet's content, which is what it always was. */
export function setSheet(script: AgentScript | undefined, patch: { title?: string; content?: string }): AgentScript | undefined {
  const { message: _message, ...rest } = script ?? {};
  return tidy({ ...rest, sheet: { ...scriptedSheet(script), ...patch } });
}

/** One line for everyone it hands to. */
export function setLine(script: AgentScript | undefined, line: string): AgentScript | undefined {
  return tidy({ ...script, says: line });
}

/** A line for one recipient, leaving the others as they are. */
export function setLineFor(script: AgentScript | undefined, agentId: string, line: string): AgentScript | undefined {
  const lines = script?.says && typeof script.says === "object" ? script.says : {};
  return tidy({ ...script, says: { ...lines, [agentId]: line } });
}

/** From one line for all to a line for each of `recipients`, every one starting as that line; and back, keeping the first. */
export function setLinePerRecipient(script: AgentScript | undefined, each: boolean, recipients: readonly string[]): AgentScript | undefined {
  const says = script?.says;
  if (each) {
    if (says && typeof says === "object") return script;
    return tidy({ ...script, says: Object.fromEntries(recipients.map((id) => [id, says ?? ""])) });
  }
  if (typeof says !== "object") return script;
  const first = recipients.map((id) => says[id]).find((line) => line) ?? Object.values(says).find((line) => line) ?? "";
  return tidy({ ...script, says: first });
}
