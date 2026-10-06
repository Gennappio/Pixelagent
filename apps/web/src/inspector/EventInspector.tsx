import { EVENT_COLOR } from "../debugger/Timeline";
import { describeEvent, formatTime } from "../debugger/transcript";
import type { AgentEvent } from "../protocol/events";
import { handOff } from "../protocol/handoff";
import { contentText } from "./documentView";
import { replay } from "../state/replayStore";
import { useUiStore } from "../state/uiStore";

/** The raw technical record behind a dot, a bubble or a transcript line. */
export function EventInspector({ event, names }: { event: AgentEvent; names: Record<string, string> }) {
  // A hand-off has two halves: what was said, and the sheet that went with it.
  const handed = event.type === "MESSAGE_SENT" || event.type === "MESSAGE_RECEIVED" ? handOff(event) : undefined;
  const written = handed ? handed.sheet?.content : event.payload.content;
  const full = written === undefined || written === null ? "" : contentText(written);
  const select = useUiStore((state) => state.select);
  // The sheets this event is about: the one it carries, or the ones it lists.
  const { documentId, documentIds } = event.payload;
  const sheets = [...(typeof documentId === "string" ? [documentId] : []), ...(Array.isArray(documentIds) ? documentIds : [])].filter(
    (id): id is string => typeof id === "string" && id !== "",
  );
  return (
    <div className="inspector">
      <h2>
        <span className="dot" style={{ background: EVENT_COLOR[event.type] }} />
        {event.type} <small>#{event.sequence}</small>
      </h2>
      <p>{describeEvent(event, names)}</p>
      <button onClick={() => replay.seek(event.sequence)}>Jump to this event</button>
      <dl className="fields">
        <div className="field">
          <dt>Time</dt>
          <dd>
            {formatTime(event.timestamp)} <span className="muted">({event.timestamp})</span>
          </dd>
        </div>
        {event.actorId && (
          <div className="field">
            <dt>Actor</dt>
            <dd>{names[event.actorId] ?? event.actorId}</dd>
          </div>
        )}
        {event.targetId && (
          <div className="field">
            <dt>Target</dt>
            <dd>{names[event.targetId] ?? event.targetId}</dd>
          </div>
        )}
        {handed?.message && (
          <div className="field">
            <dt>Said</dt>
            <dd className="message">{handed.message}</dd>
          </div>
        )}
        {full && (
          <div className="field">
            <dt>{handed?.sheet ? `Handed over${handed.sheet.title ? `: ${handed.sheet.title}` : ""}` : "Content"}</dt>
            <dd className="message">{full}</dd>
          </div>
        )}
        {sheets.length > 0 && (
          <div className="field">
            <dt>{sheets.length === 1 ? "Sheet" : "Sheets"}</dt>
            <dd className="sheet-links">
              {[...new Set(sheets)].map((id) => (
                <button key={id} onClick={() => select({ kind: "document", documentId: id })}>
                  <span className="sheet-icon" />
                  {id}
                </button>
              ))}
            </dd>
          </div>
        )}
        <div className="field">
          <dt>Payload</dt>
          <dd>
            <pre className="json">{JSON.stringify(event.payload, null, 2)}</pre>
          </dd>
        </div>
        <div className="field">
          <dt>Event id</dt>
          <dd className="muted">{event.id}</dd>
        </div>
      </dl>
    </div>
  );
}
