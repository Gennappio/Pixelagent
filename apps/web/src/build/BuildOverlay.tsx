import { useEffect } from "react";
import { useRunStore } from "../state/runStore";
import { useUiStore } from "../state/uiStore";
import { useWorkflowStore } from "../state/workflowStore";
import type { Insets } from "../world/Camera";
import { ContextMenu } from "./ContextMenu";
import { PickingBar } from "./PickingBar";

/**
 * What building lays over the world: the menu on a character, a table, a station or the
 * floor, and, while a sentence waits for its object, the bar that says so. Only with no
 * run on screen: the world never edits a run.
 */
export function BuildOverlay({ insets }: { insets: Insets }) {
  const mode = useRunStore((state) => state.mode);
  const workflowId = useWorkflowStore((state) => state.workflow.id);
  const menu = useUiStore((state) => state.menu);
  const pending = useUiStore((state) => state.pending);
  const closeMenu = useUiStore((state) => state.closeMenu);

  // A run on screen is read as it was executed, and another workflow is another office:
  // either way, what was open belongs to something that is no longer on screen.
  useEffect(() => {
    closeMenu();
  }, [mode, workflowId, closeMenu]);

  if (mode !== "build") return null;
  return (
    <div className="build-overlay">
      {pending ? <PickingBar pending={pending} /> : menu && <ContextMenu target={menu} insets={insets} />}
    </div>
  );
}
