import { useEffect, useRef } from "react";
import type { AgentEvent, AgentEventType } from "../protocol/events";
import { toolLabel } from "../protocol/workflow";
import { replay, useReplay } from "../state/replayStore";
import { useUiStore } from "../state/uiStore";

const STEP = 30;
const LANE = 30;
const PAD = 20;

export const EVENT_COLOR: Record<AgentEventType, string> = {
  RUN_STARTED: "#9aa4bf",
  RUN_FINISHED: "#9aa4bf",
  AGENT_STARTED: "#6c7a9c",
  AGENT_FINISHED: "#6c7a9c",
  MESSAGE_SENT: "#ffd166",
  MESSAGE_RECEIVED: "#c9a94a",
  DECISION: "#8ec5ff",
  TOOL_CALL: "#7fe7ff",
  TOOL_RESULT: "#8be28b",
  RUN_ERROR: "#ff5d5d",
};

interface Lane {
  id: string;
  label: string;
}

/** The lane an event's connector points at, if it links two lanes. */
function linkedLane(event: AgentEvent): string | undefined {
  if (event.type === "MESSAGE_SENT") return event.targetId;
  if (event.type === "TOOL_CALL" || event.type === "TOOL_RESULT") return `tool:${String(event.payload.tool)}`;
  return undefined;
}

export function Timeline() {
  const { position } = useReplay();
  const selection = useUiStore((state) => state.selection);
  const select = useUiStore((state) => state.select);
  const scroller = useRef<HTMLDivElement>(null);

  const events = replay.log;
  const layout = replay.worldLayout;
  const lanes: Lane[] = [
    { id: "run", label: "Run" },
    ...layout.agents.map((agent) => ({ id: agent.id, label: agent.name })),
    ...layout.tools.map((tool) => ({ id: `tool:${tool}`, label: toolLabel(tool) })),
  ];
  const laneY = (id: string | undefined) => {
    const index = lanes.findIndex((lane) => lane.id === id);
    return (index < 0 ? 0 : index) * LANE + LANE / 2;
  };
  const eventX = (index: number) => PAD + index * STEP;
  const playheadX = position === 0 ? PAD - STEP / 2 : eventX(position - 1);

  // Keep the playhead in view while it moves.
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    if (playheadX < element.scrollLeft + 40 || playheadX > element.scrollLeft + element.clientWidth - 40) {
      element.scrollLeft = Math.max(0, playheadX - element.clientWidth / 2);
    }
  }, [playheadX]);

  const width = Math.max(eventX(events.length) + PAD, 200);
  const height = lanes.length * LANE;

  return (
    <div className="timeline">
      <div className="timeline-labels">
        {lanes.map((lane) => (
          <div key={lane.id} style={{ height: LANE }}>
            {lane.label}
          </div>
        ))}
      </div>
      <div className="timeline-scroll" ref={scroller}>
        <svg width={width} height={height}>
          <defs>
            <marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
              <path d="M0,0 L8,4 L0,8 z" fill="context-stroke" />
            </marker>
          </defs>
          {lanes.map((lane) => (
            <line key={lane.id} x1={0} x2={width} y1={laneY(lane.id)} y2={laneY(lane.id)} className="lane-line" />
          ))}
          <line x1={playheadX} x2={playheadX} y1={0} y2={height} className="playhead" />
          {events.map((event, index) => {
            const x = eventX(index);
            const y = laneY(event.actorId ?? "run");
            const link = linkedLane(event);
            const linkY = link ? laneY(link) : y;
            // A tool result travels from the tool back to the agent.
            const [fromY, toY] = event.type === "TOOL_RESULT" ? [linkY, y] : [y, linkY];
            const color = EVENT_COLOR[event.type];
            const selected = selection?.kind === "event" && selection.eventId === event.id;
            return (
              <g
                key={event.id}
                className={`timeline-event${index >= position ? " pending" : ""}${index === position - 1 ? " current" : ""}`}
                onClick={() => select({ kind: "event", eventId: event.id })}
                onDoubleClick={() => replay.seek(event.sequence)}
              >
                <title>{`#${event.sequence} ${event.type} — click to inspect, double-click to jump here`}</title>
                {link && fromY !== toY && (
                  <line
                    x1={x}
                    x2={x}
                    y1={fromY}
                    y2={toY + (toY > fromY ? -7 : 7)}
                    stroke={color}
                    strokeWidth={2}
                    markerEnd="url(#arrow)"
                  />
                )}
                {link && <rect x={x - 3} y={linkY - 3} width={6} height={6} fill={color} />}
                <rect x={x - STEP / 2} y={y - LANE / 2} width={STEP} height={LANE} fill="transparent" />
                <circle cx={x} cy={y} r={selected ? 8 : 6} fill={color} className={selected ? "selected" : undefined} />
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
