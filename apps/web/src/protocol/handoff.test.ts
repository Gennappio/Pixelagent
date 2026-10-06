import { describe, expect, it } from "vitest";
import { demoEvents, eventOfType, oldDemoEvents, parallelEvents, tablesEvents } from "../testing/demoRun";
import type { AgentEvent } from "./events";
import { handOff } from "./handoff";

const sent = (payload: Record<string, unknown>): AgentEvent => ({ ...eventOfType("MESSAGE_SENT", "anna"), payload });

describe("handOff", () => {
  it("reads what was said and the sheet that went with it", () => {
    expect(handOff(eventOfType("MESSAGE_SENT", "anna"))).toEqual({
      message: "Find the latest sales number.",
      sheet: { documentId: "doc_input", version: 1, title: "Task", content: "Find the latest sales number and send it to management." },
      line: "Find the latest sales number.",
    });
  });

  it("reads words alone", () => {
    const told = eventOfType("MESSAGE_SENT", "gianni", parallelEvents);
    expect(handOff(told)).toEqual({ message: "Management has been warned.", line: "Management has been warned." });
  });

  it("stands a sheet handed over in silence by its title", () => {
    const gathered = eventOfType("MESSAGE_SENT", "stapler", tablesEvents);
    expect(handOff(gathered)).toMatchObject({ message: "", line: "Researched" });
    expect(handOff(gathered).sheet?.documentId).toBe("doc_7");
    // With no title to go by, what it says.
    expect(handOff(sent({ message: "", documentId: "doc_1", content: "The whole thing." })).line).toBe("The whole thing.");
  });

  it("says when a sheet is a photocopy", () => {
    const copy = parallelEvents.find((event) => event.type === "MESSAGE_SENT" && event.targetId === "gianni")!;
    expect(handOff(copy).sheet).toMatchObject({ documentId: "doc_1", copyOf: "doc_input", title: "Task" });
    expect("copyOf" in handOff(eventOfType("MESSAGE_SENT", "anna")).sheet!).toBe(false);
  });

  it("is the same on both sides of a hand-off", () => {
    for (const events of [demoEvents, tablesEvents, parallelEvents]) {
      const received = events.filter((event) => event.type === "MESSAGE_RECEIVED");
      expect(received.length).toBeGreaterThan(0);
      for (const event of received) {
        const send = events.find((other) => other.type === "MESSAGE_SENT" && other.actorId === event.targetId && other.targetId === event.actorId && other.sequence < event.sequence)!;
        expect(handOff(event)).toEqual(handOff(send));
      }
    }
  });

  it("reads a log from revision 2, where the words were the content of a sheet made for the occasion", () => {
    const old = eventOfType("MESSAGE_SENT", "anna", oldDemoEvents);
    expect(old.payload).toEqual({ content: "Find the latest sales number.", documentId: "doc_1", version: 1, title: "Message to Luca" });
    const read = handOff(old);
    // Nothing was said apart from the sheet, and the sheet's title was a formality: it stands by what it says.
    expect("message" in read).toBe(false);
    expect(read.line).toBe("Find the latest sales number.");
    expect(read.sheet).toEqual({ documentId: "doc_1", version: 1, title: "Message to Luca", content: "Find the latest sales number." });
    // A summary, when a runtime wrote one, is shorter than the content and stands for it.
    expect(handOff(sent({ documentId: "doc_1", title: "Message to Luca", content: "A long report…", summary: "The gist." })).line).toBe("The gist.");
  });

  it("reads a log from revision 1, where there were only words", () => {
    expect(handOff(sent({ content: "Find the latest sales number." }))).toEqual({ message: "Find the latest sales number.", line: "Find the latest sales number." });
  });

  it("makes do with whatever a payload holds", () => {
    expect(handOff(sent({}))).toEqual({ message: "", line: "" });
    expect(handOff(sent({ message: "" }))).toEqual({ message: "", line: "" });
    expect(handOff(sent({ message: 7, documentId: "", content: { a: 1 } }))).toEqual({ message: '{"a":1}', line: '{"a":1}' });
    expect(handOff(sent({ message: "Hi.", documentId: "doc_1", version: "two", title: 5 })).sheet).toEqual({ documentId: "doc_1", version: 1, title: "", content: undefined });
  });
});
