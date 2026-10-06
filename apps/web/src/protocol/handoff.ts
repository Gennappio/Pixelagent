import type { AgentEvent } from "./events";

// A hand-off (MESSAGE_SENT, MESSAGE_RECEIVED) is something said plus at most one sheet.
// The log has carried it three ways, and this is the one place that reads them all:
//
//   revision 3   message, and a sheet (documentId, version, title, content) only when there is one
//   revision 2   a sheet every time, made for the occasion, with the words as its content
//   revision 1   content: the words, and no sheet at all

export interface HandedSheet {
  documentId: string;
  version: number;
  title: string;
  content: unknown;
  /** A photocopy: the sheet it was copied from. */
  copyOf?: string;
}

export interface HandOff {
  /**
   * What was said; "" when nothing was. Undefined in a log from revision 2, where a
   * hand-off had no words of its own.
   */
  message?: string;
  sheet?: HandedSheet;
  /**
   * The hand-off in one line, for a speech bubble or a list: what was said; failing that
   * the sheet's title; and in an old log the sheet's summary, which is where the words were.
   */
  line: string;
}

function asText(value: unknown): string {
  if (typeof value === "string") return value;
  return value === undefined || value === null ? "" : JSON.stringify(value);
}

export function handOff(event: AgentEvent): HandOff {
  const { message, documentId, version, title, content, summary, copyOf } = event.payload;
  const sheet: HandedSheet | undefined =
    typeof documentId === "string" && documentId !== ""
      ? {
          documentId,
          version: typeof version === "number" && Number.isInteger(version) && version > 0 ? version : 1,
          title: typeof title === "string" ? title : "",
          content,
          ...(typeof copyOf === "string" && copyOf !== "" ? { copyOf } : {}),
        }
      : undefined;
  // Before documents existed, `content` was what was said.
  const said = typeof message === "string" ? message : sheet ? undefined : asText(content);
  const about = sheet ? asText(summary) || asText(sheet.content) : "";
  const line = said || (sheet ? (said === undefined ? about || sheet.title : sheet.title || about) : "");
  return { ...(said === undefined ? {} : { message: said }), ...(sheet ? { sheet } : {}), line };
}
