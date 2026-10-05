import { describe, expect, it } from "vitest";
import { agentRuntimeView } from "../inspector/runtimeView";
import { demoEvents } from "../testing/demoRun";
import { buildTranscript } from "./transcript";

const names = { anna: "Anna", luca: "Luca", gianni: "Gianni" };

describe("buildTranscript", () => {
  it("describes the demo run in plain sentences", () => {
    const lines = buildTranscript(demoEvents, names).map((line) => line.text);
    expect(lines).toEqual([
      "Run started with the task “Find the latest sales number and send it to management.”.",
      "Anna started working.",
      "Anna decided: Hand off to Luca.",
      "Anna told Luca: “Find the latest sales number.”",
      "Anna finished.",
      "Luca received the message from Anna.",
      "Luca started working.",
      "Luca decided: Use web_search to handle the request.",
      "Luca called Web Search (query: “Find the latest sales number.”).",
      "Web Search returned to Luca: Sales: €1.2M",
      "Luca decided: Hand off to Gianni.",
      "Luca told Gianni: “Send this result to management: Sales: €1.2M”",
      "Luca finished.",
      "Gianni received the message from Luca.",
      "Gianni started working.",
      "Gianni decided: Use send_email to handle the request.",
      "Gianni called Send Email (to: “management@example.com”).",
      "Send Email returned to Gianni: Email sent to management@example.com",
      "Gianni finished.",
      "Run finished.",
    ]);
  });

  it("keeps the event identity and time on every line", () => {
    const [first] = buildTranscript(demoEvents, names);
    expect(first).toMatchObject({ eventId: "evt_0001", sequence: 1, time: "14:31:02", isError: false });
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
    expect(view.toolCalls[0]).toMatchObject({ tool: "web_search", summary: "Sales: €1.2M", latencyMs: 230 });
    expect(view.context).toEqual([{ kind: "system" }]);
    // Events where Luca is only the target (Anna's message) are part of his trace too.
    expect(view.trace.map((e) => e.sequence)).toEqual([4, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  });
});
