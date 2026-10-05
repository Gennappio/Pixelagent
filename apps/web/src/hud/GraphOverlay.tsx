import { ReactFlowProvider } from "@xyflow/react";
import { WorkflowEditor } from "../graph/WorkflowEditor";
import type { Workflow } from "../protocol/workflow";
import { useUiStore } from "../state/uiStore";

interface Props {
  workflow: Workflow;
  /** Build mode only. With a run on screen the graph shows what was executed and cannot be changed. */
  editable: boolean;
  /** Changes when a different workflow or run comes on screen, so the graph is framed afresh. */
  resetKey: string;
}

/** The workflow as a node graph, laid over the world like a blueprint. */
export function GraphOverlay({ workflow, editable, resetKey }: Props) {
  const setPanel = useUiStore((state) => state.setPanel);
  return (
    <div className={`graph-overlay${editable ? "" : " readonly"}`}>
      <div className="graph-caption">
        <strong>Graph</strong>
        <span>{editable ? "editing the workflow" : "as executed · read-only"}</span>
        <kbd>G</kbd>
        <button className="icon" title="Close the graph (G)" aria-label="Close the graph" onClick={() => setPanel("graph", false)}>
          ✕
        </button>
      </div>
      <ReactFlowProvider>
        <WorkflowEditor key={`${resetKey}:${editable}`} workflow={workflow} editable={editable} />
      </ReactFlowProvider>
    </div>
  );
}
