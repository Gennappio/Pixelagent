import { backToBuild, replayLatest, runWorkflow, stopRun } from "../state/actions";
import { useRunStore } from "../state/runStore";
import { useUiStore } from "../state/uiStore";
import { useWorkflowStore } from "../state/workflowStore";

/** BUILD edits the workflow; RUN follows a live run; REPLAY shows a stored one. */
function ModeSwitch() {
  const mode = useRunStore((state) => state.mode);
  const hasRuns = useRunStore((state) => state.runs.length > 0);
  return (
    <div className="segmented modes" role="group" aria-label="Mode">
      <button
        className={mode === "build" ? "active build" : ""}
        aria-pressed={mode === "build"}
        title="Build: lay out and edit the workflow"
        onClick={backToBuild}
      >
        BUILD
      </button>
      <button
        className={mode === "run" ? "active run" : ""}
        aria-pressed={mode === "run"}
        title={mode === "run" ? "A run is in progress" : "Run: start the workflow and watch it live (Ctrl Enter)"}
        disabled={mode === "run"}
        onClick={() => void runWorkflow()}
      >
        RUN
      </button>
      <button
        className={mode === "replay" ? "active replay" : ""}
        aria-pressed={mode === "replay"}
        title={
          mode === "run"
            ? "Available once the run has finished"
            : hasRuns
              ? "Replay: step through the latest stored run"
              : "No stored runs yet"
        }
        disabled={mode === "run" || (mode === "build" && !hasRuns)}
        onClick={() => mode === "build" && void replayLatest()}
      >
        REPLAY
      </button>
    </div>
  );
}

export function TopBar() {
  const workflow = useWorkflowStore((state) => state.workflow);
  const dirty = useWorkflowStore((state) => state.dirty);
  const run = useRunStore((state) => state.run);
  const mode = useRunStore((state) => state.mode);
  const graph = useUiStore((state) => state.panels.graph);
  const help = useUiStore((state) => state.help);
  const toggle = useUiStore((state) => state.toggle);
  const setHelp = useUiStore((state) => state.setHelp);

  return (
    <header className="topbar">
      <h1>Pixel Agents</h1>
      <ModeSwitch />
      <span className="topbar-title" title={dirty ? "Unsaved changes" : undefined}>
        {(run?.workflow ?? workflow).name}
        {dirty && mode === "build" && <span className="unsaved"> ●</span>}
      </span>
      <span className="spacer" />
      {run && (
        <span className="muted">
          {run.id} · <span className={`status ${run.status}`}>{run.status}</span>
        </span>
      )}
      <button className={graph ? "active" : ""} aria-pressed={graph} title="Graph of the workflow (G)" onClick={() => toggle("graph")}>
        Graph <kbd>G</kbd>
      </button>
      <button className={help ? "active" : ""} aria-pressed={help} title="Keyboard shortcuts (?)" onClick={() => setHelp(!help)}>
        ?
      </button>
      {mode === "run" ? (
        // The run is the server's: stopping it ends it there, with an event that says so.
        <button className="danger run" title="Stop this run" onClick={() => void stopRun()}>
          ■ STOP
        </button>
      ) : (
        <button className="primary run" title="Run the workflow (Ctrl Enter)" onClick={() => void runWorkflow()}>
          ▶ RUN
        </button>
      )}
    </header>
  );
}
