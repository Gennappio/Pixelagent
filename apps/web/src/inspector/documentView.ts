import type { DocumentPlace, DocumentTouch } from "../protocol/documents";

// How a sheet is put into words in the inspector and the lists. Pure, like the transcript:
// the same record always reads the same.

type Names = Record<string, string>;

const named = (names: Names, id: string | undefined, fallback = "Someone") => (id ? (names[id] ?? id) : fallback);

/** Where a sheet is, as a short phrase. */
export function describePlace(place: DocumentPlace, names: Names): string {
  switch (place.kind) {
    case "tray":
      return place.tray === "in" ? "In the in-tray" : "In the out-tray";
    case "hand":
      return `In ${named(names, place.agentId)}’s hands`;
    case "table":
      return `On the table “${named(names, place.tableId)}”`;
    case "filed":
      return `Filed by ${named(names, place.agentId)}`;
  }
}

/** One line of a sheet's history. */
export function describeTouch(touch: DocumentTouch, names: Names): string {
  const agent = named(names, touch.agentId);
  const peer = named(names, touch.peerId);
  const table = `the table “${named(names, touch.tableId, "?")}”`;
  switch (touch.action) {
    case "created":
      return "Arrived in the in-tray as the task";
    case "picked_up":
      return `${agent} picked it up`;
    case "handed":
      // A sheet rewritten in someone's hands goes on as a new version of itself.
      return touch.version && touch.version > 1 ? `${agent} handed version ${touch.version} to ${peer}` : `${agent} handed it to ${peer}`;
    case "received":
      return `${agent} received it from ${peer}`;
    case "filed":
      return `${agent} filed it`;
    case "written":
      return touch.version && touch.version > 1 ? `${agent} put version ${touch.version} on ${table}` : `${agent} put it on ${table}`;
    case "read":
      return `${agent} read it on ${table}`;
    case "taken":
      return `${agent} took it from ${table}`;
    case "delivered":
      return touch.agentId ? `${agent} put it in the out-tray` : "Put in the out-tray as the result";
  }
}

/** A sheet's content as text: strings as they are, anything else as formatted JSON. */
export function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (content === undefined || content === null) return "";
  return JSON.stringify(content, null, 2);
}

/** One line of a sheet's content, for lists. The full text lives in the inspector. */
export function excerpt(content: unknown, max = 48): string {
  const single = contentText(content).replace(/\s+/g, " ").trim();
  return single.length <= max ? single : `${single.slice(0, max - 1).trimEnd()}…`;
}
