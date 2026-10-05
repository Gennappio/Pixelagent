import { EVENT_COLOR } from "../debugger/Timeline";
import { describeEvent, formatTime } from "../debugger/transcript";
import type { AgentEvent } from "../protocol/events";
import { replay } from "../state/replayStore";

/** The raw technical record behind a dot, a bubble or a transcript line. */
export function EventInspector({ event, names }: { event: AgentEvent; names: Record<string, string> }) {
  const full = typeof event.payload.content === "string" ? event.payload.content : undefined;
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
        {full && (
          <div className="field">
            <dt>Full message</dt>
            <dd className="message">{full}</dd>
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
