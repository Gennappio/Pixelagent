import { useMemo } from "react";
import { toolLabel } from "../protocol/workflow";
import { useUiStore } from "../state/uiStore";
import { useWorkflowStore } from "../state/workflowStore";
import { consultNote, describePending, pick, pickTargets, type PendingSentence } from "./picking";

/**
 * Shown while a sentence waits for its object: what has been said so far, what to pick,
 * and how to give up. A tool nobody uses yet has no station to click, so the tools the
 * server knows are listed here: choosing one finishes the sentence, and the layout stands
 * its station in the room.
 */
export function PickingBar({ pending }: { pending: PendingSentence }) {
  const workflow = useWorkflowStore((state) => state.workflow);
  const tools = useWorkflowStore((state) => state.tools);
  const edit = useWorkflowStore((state) => state.edit);
  const stopPicking = useUiStore((state) => state.stopPicking);
  const targets = useMemo(() => pickTargets(workflow, pending, tools), [workflow, pending, tools]);
  const { said, missing } = describePending(workflow, pending);
  const inTheRoom = targets.agents.length + targets.tables.length + targets.stations.length;
  const forATool = pending.verb === "uses_tool";

  return (
    <div className="picking-bar" role="status" aria-label="Pick a target">
      <div className="picking-line">
        <strong>{said}</strong>
        <span>
          {inTheRoom > 0 ? `Pick ${missing} in the office.` : forATool ? "No station for such a tool stands in the office yet." : `There is no ${missing.replace(/^an? /, "")} to pick.`}
        </span>
        <span className="spacer" />
        <button type="button" title="Give up on this sentence (Esc)" onClick={stopPicking}>
          Cancel <kbd>Esc</kbd>
        </button>
      </div>
      {targets.tools.length > 0 && (
        <div className="palette" role="group" aria-label="Tools the office does not have yet">
          <span className="muted">{inTheRoom > 0 ? "Or give it a tool the office does not have yet:" : "Give it a tool:"}</span>
          {targets.tools.map((tool) => (
            <button
              key={tool.name}
              type="button"
              title={`${tool.description} (${consultNote(tools, tool.name)})`}
              onClick={() => {
                edit((current) => pick(current, pending, { kind: "tool", id: tool.name }, tools));
                stopPicking();
              }}
            >
              {toolLabel(tool.name)}
              <small>{consultNote(tools, tool.name)}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
