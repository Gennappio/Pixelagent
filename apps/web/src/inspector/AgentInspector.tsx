import { useMemo, useState } from "react";
import { EVENT_COLOR } from "../debugger/Timeline";
import type { AgentEvent } from "../protocol/events";
import type { Agent } from "../protocol/workflow";
import { replay, useReplay } from "../state/replayStore";
import { useUiStore } from "../state/uiStore";
import { AgentConfigForm } from "./AgentConfigForm";
import { agentRuntimeView, type AgentRuntimeView } from "./runtimeView";

const TABS = ["Configuration", "Runtime", "Messages", "Tools", "Trace"] as const;
type Tab = (typeof TABS)[number];

interface Props {
  /** The agent as currently authored in the editor, if it still exists there. */
  editable?: Agent;
  /** The agent as it was in the run on screen, if a run is loaded. */
  executed?: Agent;
  names: Record<string, string>;
}

function Json({ value }: { value: unknown }) {
  return <pre className="json">{JSON.stringify(value, null, 2)}</pre>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="field">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function Runtime({ agent, view, names }: { agent: Agent; view: AgentRuntimeView; names: Record<string, string> }) {
  return (
    <dl className="fields">
      <Field label="Role">{agent.role || "—"}</Field>
      <Field label="Status">{view.error ? <span className="error-text">Error: {view.error}</span> : view.status}</Field>
      <Field label="Model">{view.model ?? `${agent.model.provider} / ${agent.model.name}`}</Field>
      <Field label="Context">≈ {view.contextTokensEstimate.toLocaleString()} tokens (estimate)</Field>
      <Field label="Last received">
        {view.lastReceived ? `${names[view.lastReceived.peerId] ?? view.lastReceived.peerId}: “${view.lastReceived.content}”` : "—"}
      </Field>
      <Field label="Last action">{view.lastAction ?? "—"}</Field>
      <Field label="Latency">{view.durationMs !== undefined ? `${(view.durationMs / 1000).toFixed(2)} s` : "—"}</Field>
      {view.context && (
        <Field label="Saved context">
          <details>
            <summary>{view.context.length} items at hand-off</summary>
            <Json value={view.context} />
          </details>
        </Field>
      )}
    </dl>
  );
}

function EventRow({ event }: { event: AgentEvent }) {
  const select = useUiStore((state) => state.select);
  return (
    <li className="row clickable" onClick={() => select({ kind: "event", eventId: event.id })}>
      <span className="dot" style={{ background: EVENT_COLOR[event.type] }} />#{event.sequence} {event.type}
    </li>
  );
}

export function AgentInspector({ editable, executed, names }: Props) {
  const agent = executed ?? editable!;
  const [tab, setTab] = useState<Tab>(executed ? "Runtime" : "Configuration");
  const select = useUiStore((state) => state.select);
  const { position } = useReplay();
  // Everything below is "as of the playhead": step back and the inspector steps back too.
  const view = useMemo(() => agentRuntimeView(replay.log.slice(0, position), agent.id), [position, agent.id]);

  return (
    <div className="inspector">
      <h2>
        {agent.name} <small>{agent.role}</small>
      </h2>
      <nav className="tabs">
        {TABS.map((name) => (
          <button key={name} className={name === tab ? "active" : ""} onClick={() => setTab(name)}>
            {name}
          </button>
        ))}
      </nav>

      {tab === "Configuration" &&
        (editable ? (
          <>
            {executed && <p className="muted">Editing the workflow. The run on screen used the configuration it was started with.</p>}
            <AgentConfigForm agent={editable} />
          </>
        ) : (
          <>
            <p className="muted">This agent is no longer in the workflow. Configuration as executed:</p>
            <Json value={agent} />
          </>
        ))}

      {tab === "Runtime" && <Runtime agent={agent} view={view} names={names} />}

      {tab === "Messages" &&
        (view.messages.length === 0 ? (
          <p className="muted">No messages yet at this point of the run.</p>
        ) : (
          <ul className="list">
            {view.messages.map((message) => (
              <li key={message.eventId} className="row clickable" onClick={() => select({ kind: "event", eventId: message.eventId })}>
                <strong>
                  {message.direction === "received" ? "from" : "to"} {names[message.peerId] ?? message.peerId}
                </strong>
                <div>{message.content}</div>
              </li>
            ))}
          </ul>
        ))}

      {tab === "Tools" &&
        (view.toolCalls.length === 0 ? (
          <p className="muted">No tool calls yet at this point of the run.</p>
        ) : (
          <ul className="list">
            {view.toolCalls.map((call) => (
              <li key={call.eventId} className="row">
                <strong className="clickable" onClick={() => select({ kind: "event", eventId: call.eventId })}>
                  {call.tool}
                </strong>
                {call.latencyMs !== undefined && <span className="muted"> · {call.latencyMs} ms</span>}
                <Json value={call.arguments} />
                {call.result === undefined ? <span className="muted">waiting for result…</span> : <Json value={call.result} />}
              </li>
            ))}
          </ul>
        ))}

      {tab === "Trace" &&
        (view.trace.length === 0 ? (
          <p className="muted">No events yet at this point of the run.</p>
        ) : (
          <ul className="list">
            {view.trace.map((event) => (
              <EventRow key={event.id} event={event} />
            ))}
          </ul>
        ))}
    </div>
  );
}
