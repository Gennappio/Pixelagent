import { describe, expect, it } from "vitest";
import { agentRuntimeView } from "../inspector/runtimeView";
import { demoEvents, eventOfType, indexOfEvent, oldDemoEvents, parallelEvents, sequenceOf, tablesEvents } from "../testing/demoRun";
import { buildTranscript, describeEvent } from "./transcript";

const names = { anna: "Anna", luca: "Luca", gianni: "Gianni", marta: "Marta", sorter: "Sorter", stapler: "Stapler", board: "Board", todo: "To research", done: "Researched" };

describe("buildTranscript", () => {
  it("describes the demo run in plain sentences", () => {
    const lines = buildTranscript(demoEvents, names).map((line) => line.text);
    expect(lines).toEqual([
      "Run started with the task “Find the latest sales number and send it to management.”.",
      "Anna started working.",
      "Anna to Luca: “Find the latest sales number.” and handed over “Task”.",
      "Anna finished.",
      "Luca received the sheet from Anna.",
      "Luca started working.",
      "Luca decided: Use web_search to handle the request.",
      "Luca called Web Search (query: “Find the latest sales number and send it to management.”).",
      "Web Search returned to Luca: Sales: €1.2M",
      "Luca to Gianni: “Send this to management.” and handed over “Sales number”.",
      "Luca finished.",
      "Gianni received the sheet from Luca.",
      "Gianni started working.",
      "Gianni decided: Use send_email to handle the request.",
      "Gianni called Send Email (to: “management@example.com”, subject: “Update from Pixel Agents”, body: “Sales: €1.2M”).",
      "Send Email returned to Gianni: Email sent to management@example.com",
      "Gianni finished.",
      "Run finished. The result is in the out-tray.",
    ]);
  });

  it("keeps the event identity and time on every line", () => {
    const [first] = buildTranscript(demoEvents, names);
    expect(first).toMatchObject({ eventId: "evt_0001", sequence: 1, time: "14:31:02", isError: false });
  });

  it("says nothing of a decision where none was made: a hand-off that always happens is just the hand-off", () => {
    const lines = buildTranscript(demoEvents, names).map((line) => line.text);
    expect(lines.filter((line) => line.includes("decided"))).toEqual(["Luca decided: Use web_search to handle the request.", "Gianni decided: Use send_email to handle the request."]);
    // A log from before, which has them, still reads as it did.
    expect(buildTranscript(oldDemoEvents, names).map((line) => line.text)[2]).toBe("Anna decided: Hand off to Luca.");
  });

  it("reads a hand-off as what was said, then what was handed over, and either half may be missing", () => {
    const sentence = (type: "MESSAGE_SENT" | "MESSAGE_RECEIVED", actor: string, nth = 0) => describeEvent(parallelEvents[indexOfEvent(parallelEvents, type, actor, nth)], names);
    // Words and a sheet; the second recipient gets a line of his own and a photocopy.
    expect(sentence("MESSAGE_SENT", "anna", 0)).toBe("Anna to Luca: “Find the latest sales number.” and handed over “Task”.");
    expect(sentence("MESSAGE_SENT", "anna", 1)).toBe("Anna to Gianni: “Warn management that the number is coming.” and handed over “Task”.");
    // Words alone.
    expect(sentence("MESSAGE_SENT", "gianni")).toBe("Gianni to Marta: “Management has been warned.”");
    expect(sentence("MESSAGE_RECEIVED", "marta", 1)).toBe("Marta received the message from Gianni.");
    expect(sentence("MESSAGE_RECEIVED", "marta", 0)).toBe("Marta received the sheet from Luca.");
    // A sheet alone: the collector says nothing.
    expect(describeEvent(eventOfType("MESSAGE_SENT", "stapler", tablesEvents), names)).toBe("Stapler handed “Researched” to Gianni.");
    // Neither: it still happened.
    expect(describeEvent({ ...eventOfType("MESSAGE_SENT", "anna"), payload: { message: "" } }, names)).toBe("Anna had nothing to say or hand to Luca.");
  });

  it("says consulted for a tool the runtime called first, and called for one the agent chose", () => {
    const consulted = eventOfType("TOOL_CALL", "luca", tablesEvents);
    expect(describeEvent(consulted, names)).toBe("Luca consulted Web Search (query: “Supplier A”).");
    expect(describeEvent(eventOfType("TOOL_CALL", "gianni", tablesEvents), names)).toMatch(/^Gianni called Send Email \(/);
    expect(describeEvent({ ...consulted, payload: { ...consulted.payload, required: "yes" } }, names)).toMatch(/^Luca called Web Search/);
  });

  it("has a sentence for everything that happens at a table", () => {
    const sentence = (type: "DOCUMENT_WRITTEN" | "DOCUMENT_TAKEN" | "DOCUMENT_READ", actor: string, nth = 0) =>
      describeEvent(tablesEvents[indexOfEvent(tablesEvents, type, actor, nth)], names);
    expect(sentence("DOCUMENT_WRITTEN", "sorter")).toBe("Sorter put “Supplier A” on the table “To research”.");
    expect(sentence("DOCUMENT_TAKEN", "luca", 0)).toBe("Luca took a sheet from the table “To research”, 1 left.");
    // Luca writes on the pile of what is done, then on the board; the second time round the board gets a new version.
    expect(sentence("DOCUMENT_WRITTEN", "luca", 0)).toBe("Luca put “Finding” on the table “Researched”.");
    expect(sentence("DOCUMENT_WRITTEN", "luca", 1)).toBe("Luca put “Finding” on the table “Board”.");
    expect(sentence("DOCUMENT_TAKEN", "luca", 1)).toBe("Luca took a sheet from the table “To research”, 0 left.");
    expect(sentence("DOCUMENT_WRITTEN", "luca", 3)).toBe("Luca put version 2 of “Finding” on the table “Board”.");
    expect(sentence("DOCUMENT_TAKEN", "stapler", 1)).toBe("Stapler took a sheet from the table “Researched”, 0 left.");
    expect(sentence("DOCUMENT_READ", "gianni")).toBe("Gianni read the sheet on the table “Board”.");
  });

  it("counts the sheets when more than one is read", () => {
    const read = eventOfType("DOCUMENT_READ", "gianni", tablesEvents);
    const several = { ...read, payload: { ...read.payload, documentIds: ["doc_1", "doc_2", "doc_3"] } };
    expect(describeEvent(several, names)).toBe("Gianni read 3 sheets on the table “Board”.");
  });

  it("falls back to the id of a table or an agent it has no name for", () => {
    expect(describeEvent(eventOfType("DOCUMENT_WRITTEN", "sorter", tablesEvents), {})).toBe("sorter put “Supplier A” on the table “todo”.");
  });

  it("reads a log from revision 2, where the words were on the sheet, by what the sheet says", () => {
    const lines = buildTranscript(oldDemoEvents, names).map((line) => line.text);
    expect(lines).toHaveLength(20);
    // The sheet's title then was “Message to Luca”: a formality. What matters is what it said.
    expect(lines[3]).toBe("Anna handed “Find the latest sales number.” to Luca.");
    expect(lines[5]).toBe("Luca received the sheet from Anna.");
    expect(lines[8]).toBe("Luca called Web Search (query: “Find the latest sales number.”).");
    expect(lines[11]).toBe("Luca handed “Send this result to management: Sales: €1.2M” to Gianni.");
    expect(lines[19]).toBe("Run finished. The result is in the out-tray.");
  });

  it("reads a log from before messages were sheets as words and nothing else", () => {
    const sent = eventOfType("MESSAGE_SENT", "anna");
    const legacy = { ...sent, payload: { content: "Find the latest sales number." } };
    expect(describeEvent(legacy, names)).toBe("Anna to Luca: “Find the latest sales number.”");
    expect(describeEvent({ ...eventOfType("MESSAGE_RECEIVED", "luca"), payload: {} }, names)).toBe("Luca received the message from Anna.");
    expect(describeEvent({ ...eventOfType("RUN_FINISHED"), payload: { output: "x" } }, names)).toBe("Run finished.");
  });
});

describe("agentRuntimeView", () => {
  it("reflects the agent as of the playhead", () => {
    const midCall = agentRuntimeView(demoEvents.slice(0, sequenceOf(demoEvents, "TOOL_CALL", "luca")), "luca");
    expect(midCall.status).toBe("Waiting for tool");
    // What he was told, and the sheet that came with it.
    expect(midCall.lastReceived).toEqual({
      eventId: eventOfType("MESSAGE_RECEIVED", "luca").id,
      direction: "received",
      peerId: "anna",
      said: "Find the latest sales number.",
      sheet: { documentId: "doc_input", title: "Task" },
      content: "Find the latest sales number.",
    });
    expect(midCall.toolCalls).toHaveLength(1);
    expect(midCall.toolCalls[0].result).toBeUndefined();
    expect(midCall.context).toBeUndefined();
    expect(agentRuntimeView(demoEvents.slice(0, sequenceOf(demoEvents, "MESSAGE_RECEIVED", "luca")), "luca").status).toBe("Handed a sheet");
  });

  it("collects hand-offs, tool calls and the saved context once finished", () => {
    const view = agentRuntimeView(demoEvents, "luca");
    expect(view.status).toBe("Finished");
    expect(view.messages.map((m) => [m.direction, m.peerId, m.said, m.sheet?.title])).toEqual([
      ["received", "anna", "Find the latest sales number.", "Task"],
      ["sent", "gianni", "Send this to management.", "Sales number"],
    ]);
    expect(view.toolCalls[0]).toMatchObject({ tool: "web_search", summary: "Sales: €1.2M", arguments: { query: "Find the latest sales number and send it to management." } });
    expect(view.toolCalls[0].latencyMs).toBeTypeOf("number");
    // The context the runtime saved at hand-off: what arrived (the words, then the sheet), what he did, wrote and handed on.
    expect((view.context as { kind: string }[]).map((item) => item.kind)).toEqual([
      "system",
      "message",
      "document",
      "decision",
      "tool_call",
      "tool_result",
      "sheet",
      "message_out",
    ]);
    // Events where Luca is only the target (Anna's hand-off, Gianni's receipt) are part of his trace too.
    const involved = demoEvents.filter((event) => event.actorId === "luca" || event.targetId === "luca");
    expect(view.trace).toEqual(involved);
    expect([view.trace[0].actorId, view.trace.at(-1)!.actorId]).toEqual(["anna", "gianni"]);
    expect(view.trace).toHaveLength(9);
  });

  it("tells words alone from a sheet handed in silence, and reads an old hand-off by what its sheet says", () => {
    const marta = agentRuntimeView(parallelEvents, "marta").messages;
    expect(marta.map((m) => [m.peerId, m.said, m.sheet?.documentId, m.content])).toEqual([
      ["luca", "Here is the number.", "doc_2", "Here is the number."],
      ["gianni", "Management has been warned.", undefined, "Management has been warned."],
    ]);
    expect(agentRuntimeView(parallelEvents.slice(0, sequenceOf(parallelEvents, "MESSAGE_RECEIVED", "marta", 1)), "marta").status).toBe("Told something");
    const gianni = agentRuntimeView(tablesEvents, "gianni").messages;
    expect(gianni.map((m) => [m.said, m.sheet?.title, m.content])).toEqual([["", "Researched", "Researched"]]);
    const old = agentRuntimeView(oldDemoEvents, "luca").messages;
    expect(old.map((m) => [m.said, m.sheet?.title, m.content])).toEqual([
      ["", "Message to Luca", "Find the latest sales number."],
      ["", "Message to Gianni", "Send this result to management: Sales: €1.2M"],
    ]);
  });
});
