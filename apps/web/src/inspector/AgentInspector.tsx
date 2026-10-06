import { useMemo, useState } from "react";
import { EVENT_COLOR } from "../debugger/Timeline";
import { documentsTouchedBy, foldDocuments, latestVersion } from "../protocol/documents";
import type { AgentEvent } from "../protocol/events";
import { toolLabel, type Agent } from "../protocol/workflow";
import { backToBuild } from "../state/actions";
import { replay, useReplay } from "../state/replayStore";
import { useUiStore } from "../state/uiStore";
import { spriteFor } from "../world/sprites";
import { AgentConfigForm } from "./AgentConfigForm";
import { describePlace, excerpt } from "./documentView";
import { agentRuntimeView, type AgentRuntimeView } from "./runtimeView";

const TABS = ["Configuration", "Runtime", "Messages", "Tools", "Sheets", "Trace"] as const;
type Tab = (typeof TABS)[number];

interface Props {
  /** The agent being built, or the one that ran when a run is on screen. */
  agent: Agent;
  /** Build mode: the configuration can be changed and there is no run to inspect. */
  editable: boolean;
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

/** The configuration a run was started with. Read-only: only build mode edits the workflow. */
function ConfigurationAsExecuted({ agent }: { agent: Agent }) {
  return (
    <>
      <p className="muted">As executed in this run.</p>
      <button onClick={backToBuild}>◂ Back to BUILD to edit</button>
      <dl className="fields">
        <Field label="Name">{agent.name}</Field>
        <Field label="Role">{agent.role || "—"}</Field>
        <Field label="System prompt">
          <div className="message">{agent.systemPrompt || "—"}</div>
        </Field>
        <Field label="Model">
          {agent.model.provider} / {agent.model.name}
        </Field>
        {agent.model.script?.message && (
          <Field label="Scripted message">
            <div className="message">{agent.model.script.message}</div>
          </Field>
        )}
        <Field label="Tools">{agent.tools.map((tool) => toolLabel(tool.name)).join(", ") || "—"}</Field>
        <Field label="Sprite">{spriteFor(agent.appearance.sprite).label}</Field>
        <Field label="Id">
          <span className="muted">{agent.id}</span>
        </Field>
      </dl>
    </>
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

export function AgentInspector({ agent, editable, names }: Props) {
  const [tab, setTab] = useState<Tab>("Runtime");
  const select = useUiStore((state) => state.select);
  const { position } = useReplay();
  // Everything below is "as of the playhead": step back and the inspector steps back too.
  const view = useMemo(() => agentRuntimeView(replay.log.slice(0, position), agent.id), [position, agent.id]);
  // The sheets this agent wrote, held, read or was handed, as of the playhead.
  const sheets = useMemo(
    () => documentsTouchedBy(foldDocuments(replay.log.slice(0, position)), agent.id),
    [position, agent.id],
  );

  if (editable) {
    // No run on screen: there is nothing to inspect yet, only the agent to configure.
    return (
      <div className="inspector">
        <h2>
          {agent.name} <small>{agent.role}</small>
        </h2>
        <AgentConfigForm agent={agent} />
      </div>
    );
  }

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

      {tab === "Configuration" && <ConfigurationAsExecuted agent={agent} />}

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

      {tab === "Sheets" &&
        (sheets.length === 0 ? (
          <p className="muted">No sheets yet at this point of the run.</p>
        ) : (
          <ul className="list">
            {sheets.map((record) => (
              <li key={record.id} className="row clickable" onClick={() => select({ kind: "document", documentId: record.id })}>
                <strong>
                  <span className="sheet-icon" />
                  {latestVersion(record).title || record.id}
                  {record.versions.length > 1 && <small> v{latestVersion(record).version}</small>}
                </strong>
                <div>{excerpt(latestVersion(record).content, 80)}</div>
                <div className="muted">{describePlace(record.place, names)}</div>
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
