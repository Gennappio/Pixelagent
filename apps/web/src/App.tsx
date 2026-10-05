import { ReactFlowProvider } from "@xyflow/react";
import { useEffect, useMemo } from "react";
import { PlaybackBar } from "./debugger/PlaybackBar";
import { Timeline } from "./debugger/Timeline";
import { Transcript } from "./debugger/TranscriptPanel";
import { WorkflowEditor } from "./graph/WorkflowEditor";
import { Inspector } from "./inspector/Inspector";
import { Sidebar } from "./Sidebar";
import { replay } from "./state/replayStore";
import { useRunStore } from "./state/runStore";
import { useUiStore } from "./state/uiStore";
import { useWorkflowStore } from "./state/workflowStore";
import { buildLayout } from "./world/layout";
import { WorldView } from "./world/WorldView";

/** Advances visualization time once per frame, whichever view is on screen. */
function useReplayClock(): void {
  useEffect(() => {
    let frame = 0;
    let last = performance.now();
    const loop = (now: number) => {
      // Cap the step so returning from a background tab does not fast-forward the scene.
      replay.tick(Math.min(now - last, 100));
      last = now;
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, []);
}

export function App() {
  const { workflow, dirty, error: workflowError, init, save } = useWorkflowStore();
  const { run, mode, error: runError, start, close, refresh } = useRunStore();
  const { view, setView } = useUiStore();

  useReplayClock();

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    void refresh(workflow.id);
  }, [workflow.id, refresh]);

  // With no run on screen the world previews the workflow being edited.
  useEffect(() => {
    if (mode === "idle") replay.load([], buildLayout(workflow));
  }, [mode, workflow]);

  // Names shown in the transcript and inspector come from the run when there is one.
  const shown = run?.workflow ?? workflow;
  const names = useMemo(() => Object.fromEntries(shown.agents.map((agent) => [agent.id, agent.name])), [shown]);

  const onRun = async () => {
    try {
      const saved = dirty || !workflow.id ? await save() : workflow;
      setView("world");
      await start(saved, saved.input);
    } catch {
      // the stores already surface the error
    }
  };

  const error = workflowError ?? runError;

  return (
    <div className="app">
      <header className="topbar">
        <h1>Pixel Agents</h1>
        <div className="segmented">
          <button className={view === "graph" ? "active" : ""} onClick={() => setView("graph")}>
            GRAPH
          </button>
          <button className={view === "world" ? "active" : ""} onClick={() => setView("world")}>
            WORLD
          </button>
        </div>
        <span className="spacer" />
        {run && (
          <span className="muted">
            {run.id} · {run.status}
            <button title="Close this run and go back to the workflow preview" onClick={close}>
              ✕
            </button>
          </span>
        )}
        <button className="primary run" disabled={mode === "live"} onClick={() => void onRun()}>
          ▶ RUN
        </button>
      </header>

      {error && <div className="error-banner">{error}</div>}

      <Sidebar />

      <main className="main-view">
        {view === "graph" ? (
          <ReactFlowProvider>
            <WorkflowEditor />
          </ReactFlowProvider>
        ) : (
          <WorldView />
        )}
      </main>

      <aside className="inspector-panel">
        <Inspector names={names} />
      </aside>

      <footer className="bottom">
        <PlaybackBar />
        <div className="bottom-split">
          <Timeline />
          <Transcript names={names} />
        </div>
      </footer>
    </div>
  );
}
