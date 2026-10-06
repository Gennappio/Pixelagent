import { describe, expect, it } from "vitest";
import { agentRuntimeView } from "../inspector/runtimeView";
import { demoEvents, eventOfType, tablesEvents } from "../testing/demoRun";
import { buildTranscript, describeEvent } from "./transcript";

const names = { anna: "Anna", luca: "Luca", gianni: "Gianni", sorter: "Sorter", stapler: "Stapler", board: "Board", todo: "To research", done: "Researched" };

describe("buildTranscript", () => {
  it("describes the demo run in plain sentences", () => {
    const lines = buildTranscript(demoEvents, names).map((line) => line.text);
    expect(lines).toEqual([
      "Run started with the task “Find the latest sales number and send it to management.”.",
      "Anna started working.",
      "Anna decided: Hand off to Luca.",
      "Anna handed Luca a sheet: “Find the latest sales number.”",
      "Anna finished.",
      "Luca received the sheet from Anna.",
      "Luca started working.",
      "Luca decided: Use web_search to handle the request.",
      "Luca called Web Search (query: “Find the latest sales number.”).",
      "Web Search returned to Luca: Sales: €1.2M",
      "Luca decided: Hand off to Gianni.",
      "Luca handed Gianni a sheet: “Send this result to management: Sales: €1.2M”",
      "Luca finished.",
      "Gianni received the sheet from Luca.",
      "Gianni started working.",
      "Gianni decided: Use send_email to handle the request.",
      "Gianni called Send Email (to: “management@example.com”, subject: “Update from Pixel Agents”, body: “Send this result to management: Sales: €1.2M”).",
      "Send Email returned to Gianni: Email sent to management@example.com",
      "Gianni finished.",
      "Run finished. The result is in the out-tray.",
    ]);
  });

  it("keeps the event identity and time on every line", () => {
    const [first] = buildTranscript(demoEvents, names);
    expect(first).toMatchObject({ eventId: "evt_0001", sequence: 1, time: "14:31:02", isError: false });
  });

  it("has a sentence for everything that happens at a table", () => {
    const sentence = (sequence: number) => describeEvent(tablesEvents[sequence - 1], names);
    expect(sentence(8)).toBe("Sorter put “Supplier A” on the table “To research”.");
    expect(sentence(12)).toBe("Luca took a sheet from the table “To research”, 1 left.");
    expect(sentence(17)).toBe("Luca put “Board” on the table “Board”.");
    expect(sentence(20)).toBe("Luca took a sheet from the table “To research”, 0 left.");
    expect(sentence(25)).toBe("Luca put version 2 of “Board” on the table “Board”.");
    expect(sentence(29)).toBe("Stapler took a sheet from the table “Researched”, 0 left.");
    expect(sentence(35)).toBe("Gianni read the sheet on the table “Board”.");
  });

  it("counts the sheets when more than one is read", () => {
    const read = eventOfType("DOCUMENT_READ", "gianni", tablesEvents);
    const several = { ...read, payload: { ...read.payload, documentIds: ["doc_1", "doc_2", "doc_3"] } };
    expect(describeEvent(several, names)).toBe("Gianni read 3 sheets on the table “Board”.");
  });

  it("falls back to the id of a table or an agent it has no name for", () => {
    expect(describeEvent(tablesEvents[7], {})).toBe("sorter put “Supplier A” on the table “todo”.");
  });

  it("keeps the old wording for logs written before messages were sheets", () => {
    const sent = eventOfType("MESSAGE_SENT", "anna");
    const legacy = { ...sent, payload: { content: "Find the latest sales number." } };
    expect(describeEvent(legacy, names)).toBe("Anna told Luca: “Find the latest sales number.”");
    expect(describeEvent({ ...eventOfType("MESSAGE_RECEIVED", "luca"), payload: {} }, names)).toBe("Luca received the message from Anna.");
    expect(describeEvent({ ...eventOfType("RUN_FINISHED"), payload: { output: "x" } }, names)).toBe("Run finished.");
  });
});

describe("agentRuntimeView", () => {
  it("reflects the agent as of the playhead", () => {
    const midCall = agentRuntimeView(demoEvents.slice(0, 9), "luca");
    expect(midCall.status).toBe("Waiting for tool");
    expect(midCall.lastReceived).toMatchObject({ peerId: "anna", content: "Find the latest sales number." });
    expect(midCall.toolCalls).toHaveLength(1);
    expect(midCall.toolCalls[0].result).toBeUndefined();
    expect(midCall.context).toBeUndefined();
  });

  it("collects messages, tool calls and the saved context once finished", () => {
    const view = agentRuntimeView(demoEvents, "luca");
    expect(view.status).toBe("Finished");
    expect(view.messages.map((m) => [m.direction, m.peerId])).toEqual([
      ["received", "anna"],
      ["sent", "gianni"],
    ]);
    expect(view.toolCalls[0]).toMatchObject({ tool: "web_search", summary: "Sales: €1.2M", arguments: { query: "Find the latest sales number." } });
    expect(view.toolCalls[0].latencyMs).toBeTypeOf("number");
    // The context the runtime saved at hand-off, sheets included.
    expect((view.context as { kind: string }[]).map((item) => item.kind)).toEqual([
      "system",
      "message",
      "decision",
      "tool_call",
      "tool_result",
      "decision",
      "message_out",
    ]);
    // Events where Luca is only the target (Anna's message) are part of his trace too.
    expect(view.trace.map((e) => e.sequence)).toEqual([4, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  });
});
