import { toolLabel } from "../protocol/workflow";
import { replay, useReplay } from "../state/replayStore";
import { useRunStore } from "../state/runStore";
import { useUiStore } from "../state/uiStore";
import { useWorkflowStore } from "../state/workflowStore";
import { AgentInspector } from "./AgentInspector";
import { DocumentInspector } from "./DocumentInspector";
import { EventInspector } from "./EventInspector";

function ToolInspector({ tool }: { tool: string }) {
  const description = useWorkflowStore((state) => state.tools.find((candidate) => candidate.name === tool));
  const select = useUiStore((state) => state.select);
  const { position } = useReplay();
  const calls = replay.log.slice(0, position).filter((event) => event.type === "TOOL_CALL" && event.payload.tool === tool);
  return (
    <div className="inspector">
      <h2>
        {toolLabel(tool)} <small>tool</small>
      </h2>
      <p>{description?.description ?? "Unknown tool."}</p>
      {description && (
        <details>
          <summary>Arguments schema</summary>
          <pre className="json">{JSON.stringify(description.schema, null, 2)}</pre>
        </details>
      )}
      <h3>Calls so far</h3>
      {calls.length === 0 ? (
        <p className="muted">None at this point of the run.</p>
      ) : (
        <ul className="list">
          {calls.map((event) => (
            <li key={event.id} className="row clickable" onClick={() => select({ kind: "event", eventId: event.id })}>
              #{event.sequence} by {event.actorId}
              <pre className="json">{JSON.stringify(event.payload.arguments, null, 2)}</pre>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Inspector({ names }: { names: Record<string, string> }) {
  const selection = useUiStore((state) => state.selection);
  const workflow = useWorkflowStore((state) => state.workflow);
  const run = useRunStore((state) => state.run);
  useReplay(); // the log may have grown since the selection was made

  if (selection?.kind === "agent") {
    // With a run on screen the inspector describes the agent that ran, not the one being edited.
    const agent = (run?.workflow ?? workflow).agents.find((candidate) => candidate.id === selection.agentId);
    if (agent) {
      // Keyed so switching agents (or loading a run) resets the open tab.
      return <AgentInspector key={`${agent.id}:${run?.id ?? "build"}`} agent={agent} editable={!run} names={names} />;
    }
  }
  if (selection?.kind === "event") {
    const event = replay.log.find((candidate) => candidate.id === selection.eventId);
    if (event) return <EventInspector event={event} names={names} />;
  }
  if (selection?.kind === "tool") return <ToolInspector tool={selection.tool} />;
  // Keyed so that picking another sheet goes back to showing its latest version.
  if (selection?.kind === "document") return <DocumentInspector key={selection.documentId} documentId={selection.documentId} names={names} />;

  return (
    <div className="inspector empty">
      <p>Click a character, a sheet, a tool, a speech bubble or a timeline event to inspect it.</p>
    </div>
  );
}
