import { useEffect } from "react";
import { adjacentSpeed } from "../debugger/ReplayController";
import { runWorkflow, saveWorkflow } from "../state/actions";
import { zoomCamera } from "../state/cameraStore";
import { replay, seekToPosition } from "../state/replayStore";
import { useRunStore } from "../state/runStore";
import { useUiStore } from "../state/uiStore";
import { shortcutFor, type KeyTarget, type ShortcutAction } from "./shortcuts";

function targetKind(target: EventTarget | null): KeyTarget {
  if (!(target instanceof HTMLElement)) return "other";
  if (target.isContentEditable || target.closest("input, textarea, select")) return "editable";
  if (target.closest("button, a[href], summary, [role='button']")) return "button";
  return "other";
}

function perform(action: ShortcutAction): void {
  const ui = useUiStore.getState();
  const { playing, speed, total, streaming } = replay.getSnapshot();
  switch (action.type) {
    case "togglePanel":
      return ui.toggle(action.panel);
    case "toggleAll":
      return ui.toggleAll();
    case "help":
      return ui.setHelp(!ui.help);
    case "escape":
      if (ui.help) return ui.setHelp(false);
      if (ui.panels.graph) return ui.setPanel("graph", false);
      return ui.select(null);
    case "playPause":
      if (playing) return replay.pause();
      if (total > 0 || streaming) replay.play();
      return;
    case "next":
      return replay.next();
    case "previous":
      return replay.previous();
    case "toStart":
      return seekToPosition(0);
    case "toEnd":
      return seekToPosition(total);
    case "faster":
      return replay.setSpeed(adjacentSpeed(speed, 1));
    case "slower":
      return replay.setSpeed(adjacentSpeed(speed, -1));
    case "zoomIn":
      return zoomCamera(1);
    case "zoomOut":
      return zoomCamera(-1);
    case "run":
      return void runWorkflow();
    case "save":
      // Only build mode has anything to save: run and replay never edit the workflow.
      if (useRunStore.getState().mode === "build") saveWorkflow();
      return;
  }
}

/** Binds the shortcut table to the keyboard for as long as the app is mounted. */
export function useShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      const action = shortcutFor({
        key: event.key,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
        repeat: event.repeat,
        target: targetKind(event.target),
      });
      if (!action) return;
      event.preventDefault();
      perform(action);
    };

    // A button clicked with the mouse would keep the focus and swallow the next Space.
    // Keyboard activation (detail 0) keeps its focus, so tabbing through controls still works.
    const releaseFocus = (event: MouseEvent) => {
      if (event.detail === 0 || !(event.target instanceof Element)) return;
      const control = event.target.closest("button, input[type='range'], input[type='checkbox']");
      if (control instanceof HTMLElement) control.blur();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("click", releaseFocus);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("click", releaseFocus);
    };
  }, []);
}
