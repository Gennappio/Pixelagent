import { useEffect, useMemo, type CSSProperties } from "react";
import { PlaybackBar } from "./debugger/PlaybackBar";
import { Timeline } from "./debugger/Timeline";
import { Transcript } from "./debugger/TranscriptPanel";
import { GraphOverlay } from "./hud/GraphOverlay";
import { OfficePanel } from "./hud/OfficePanel";
import { Panel } from "./hud/Panel";
import { HUD, worldInsets } from "./hud/panels";
import { ShortcutHelp } from "./hud/ShortcutHelp";
import { TopBar } from "./hud/TopBar";
import { useShortcuts } from "./hud/useShortcuts";
import { Inspector } from "./inspector/Inspector";
import { replay } from "./state/replayStore";
import { useRunStore } from "./state/runStore";
import { useUiStore } from "./state/uiStore";
import { useWorkflowStore } from "./state/workflowStore";
import { buildLayout, type WorldLayout } from "./world/layout";
import { WorldView } from "./world/WorldView";

/** Advances visualization time once per frame. */
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

/**
 * The shell: the pixel world fills the screen and everything else floats over it as
 * collapsible panels. Build mode edits the workflow; run and replay only read events.
 */
export function App() {
  const { workflow, error: workflowError, init } = useWorkflowStore();
  const { run, mode, error: runError, refresh } = useRunStore();
  const panels = useUiStore((state) => state.panels);
  const help = useUiStore((state) => state.help);

  useReplayClock();
  useShortcuts();

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    void refresh(workflow.id);
  }, [workflow.id, refresh]);

  // With no run on screen the world previews the workflow being built. Keyed on the
  // layout's content, so typing a prompt does not rebuild a scene that has not changed.
  const previewKey = useMemo(() => JSON.stringify(buildLayout(workflow)), [workflow]);
  useEffect(() => {
    if (mode === "build") replay.load([], JSON.parse(previewKey) as WorldLayout);
  }, [mode, previewKey]);

  // Names shown in the log and the inspector come from the run when there is one.
  const shown = run?.workflow ?? workflow;
  const names = useMemo(() => Object.fromEntries(shown.agents.map((agent) => [agent.id, agent.name])), [shown]);

  const insets = useMemo(() => worldInsets(panels), [panels.office, panels.inspector]);
  const geometry = {
    "--hud-gap": `${HUD.gap}px`,
    "--office-w": `${HUD.officeWidth}px`,
    "--inspector-w": `${HUD.inspectorWidth}px`,
    "--inset-left": `${insets.left}px`,
    "--inset-right": `${insets.right}px`,
  } as CSSProperties;

  const error = workflowError ?? runError;

  return (
    <div className="app">
      <TopBar />
      {error && <div className="error-banner">{error}</div>}

      <main className="stage" style={geometry}>
        <WorldView insets={insets} />
        {panels.graph && <GraphOverlay workflow={shown} editable={mode === "build"} resetKey={run?.id ?? workflow.id} />}

        <div className="hud-column left">
          <Panel id="office" title="Office" hotkey="O" className="office-panel">
            <OfficePanel />
          </Panel>
          {run && (
            <Panel id="log" title="Log" hotkey="L" className="log-panel">
              <Transcript names={names} />
            </Panel>
          )}
        </div>
        <div className="hud-column right">
          <Panel id="inspector" title="Inspector" hotkey="I" className="inspector-panel">
            <Inspector names={names} />
          </Panel>
        </div>

        {help && <ShortcutHelp />}
      </main>

      <footer className="dock">
        {panels.timeline && (
          <div className="timeline-drawer">
            <Timeline />
          </div>
        )}
        <PlaybackBar />
      </footer>
    </div>
  );
}
