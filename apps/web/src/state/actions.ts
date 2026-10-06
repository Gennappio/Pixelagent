import { useRunStore } from "./runStore";
import { useWorkflowStore } from "./workflowStore";

// What the top bar, the panels and the keyboard shortcuts all trigger. Kept out of the
// components so that each of them does the same thing.

/** Saves pending edits, then starts a live run of the workflow being built. */
export async function runWorkflow(): Promise<void> {
  if (useRunStore.getState().mode === "run") return;
  const { workflow, dirty, save } = useWorkflowStore.getState();
  try {
    const saved = dirty || !workflow.id ? await save() : workflow;
    await useRunStore.getState().start(saved, saved.input);
  } catch {
    // the stores already surface the error
  }
}

/** Stops the live run on screen. */
export async function stopRun(): Promise<void> {
  await useRunStore.getState().stop();
}

/** Takes the run off the screen: the world goes back to previewing the workflow. */
export function backToBuild(): void {
  useRunStore.getState().close();
}

/** Opens the most recent run of this workflow. */
export async function replayLatest(): Promise<void> {
  const { runs, open } = useRunStore.getState();
  if (runs.length > 0) await open(runs[0].id);
}

export function saveWorkflow(): void {
  const { dirty, save } = useWorkflowStore.getState();
  if (dirty) void save().catch(() => {});
}
