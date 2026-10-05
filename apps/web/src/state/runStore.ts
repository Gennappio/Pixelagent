import { create } from "zustand";
import { api, openRunStream } from "../api/client";
import type { AgentEvent } from "../protocol/events";
import type { Run, RunSummary, Workflow } from "../protocol/workflow";
import { buildLayout } from "../world/layout";
import { replay } from "./replayStore";

interface RunState {
  runs: RunSummary[];
  /** The run on screen, if any. Its workflow snapshot is what the world shows. */
  run: Run | null;
  /**
   * build: no run on screen, the world previews the workflow being edited.
   * run: following a live run. replay: showing a stored one.
   * Only build edits the workflow; run and replay only read events.
   */
  mode: "build" | "run" | "replay";
  error: string | null;

  refresh: (workflowId: string) => Promise<void>;
  start: (workflow: Workflow, input: string) => Promise<void>;
  open: (runId: string) => Promise<void>;
  /** Replays a run from a saved export file; no server involved. */
  openExport: (data: { run: Run; events: AgentEvent[] }) => void;
  close: () => void;
}

let closeStream: (() => void) | null = null;

function stopStream(): void {
  closeStream?.();
  closeStream = null;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const useRunStore = create<RunState>((set, get) => {
  /** LIVE: events come from the WebSocket into the same controller replay uses. */
  function follow(run: Run): void {
    stopStream();
    replay.load([], buildLayout(run.workflow), { streaming: true });
    replay.play();
    set({ run, mode: "run", error: null });
    closeStream = openRunStream(
      run.id,
      (event) => replay.append(event),
      () => {
        closeStream = null;
        replay.setStreaming(false);
        if (get().run?.id === run.id) {
          set({ mode: "replay" });
          // Pick up the final status now that execution is over.
          void api.getRun(run.id).then((finished) => get().run?.id === run.id && set({ run: finished }), () => {});
        }
        void get().refresh(run.workflowId);
      },
    );
  }

  /** REPLAY: events come from storage. */
  function show(run: Run, events: AgentEvent[]): void {
    stopStream();
    replay.load(events, buildLayout(run.workflow));
    replay.play();
    set({ run, mode: "replay", error: null });
  }

  return {
    runs: [],
    run: null,
    mode: "build",
    error: null,

    refresh: async (workflowId) => {
      if (!workflowId) return set({ runs: [] });
      try {
        set({ runs: await api.listRuns(workflowId) });
      } catch (error) {
        set({ error: message(error) });
      }
    },

    start: async (workflow, input) => {
      try {
        follow(await api.startRun(workflow.id, input));
        // List the run while it is still going, not only once it has finished.
        void get().refresh(workflow.id);
      } catch (error) {
        set({ error: message(error) });
      }
    },

    open: async (runId) => {
      try {
        const run = await api.getRun(runId);
        if (run.status === "running") follow(run);
        else show(run, await api.getRunEvents(runId));
      } catch (error) {
        set({ error: message(error) });
      }
    },

    openExport: ({ run, events }) => show(run, events),

    close: () => {
      stopStream();
      set({ run: null, mode: "build" });
    },
  };
});
