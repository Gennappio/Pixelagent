import { ReactFlowProvider } from "@xyflow/react";
import { GraphView } from "../graph/GraphView";
import type { Workflow } from "../protocol/workflow";
import { useUiStore } from "../state/uiStore";
import { PixelIcon } from "./PixelIcon";

interface Props {
  workflow: Workflow;
  /** Changes when a different workflow or run comes on screen, so the graph is framed afresh. */
  resetKey: string;
  /** With a run on screen the graph shows what was executed. */
  executed: boolean;
}

/** The workflow as a node graph, laid over the world like a blueprint. */
export function GraphOverlay({ workflow, resetKey, executed }: Props) {
  const setPanel = useUiStore((state) => state.setPanel);
  // Framed again whenever the shape of the graph changes: an agent or a sentence more or less.
  const shape = `${resetKey}:${workflow.agents.length}:${workflow.tables.length}:${workflow.relations.length}`;
  return (
    <div className="graph-overlay readonly">
      <div className="graph-caption">
        <strong>Graph</strong>
        <span>{executed ? "as executed" : "drawn from what the agents do"}</span>
        <kbd>G</kbd>
        <button className="icon" title="Close the graph (G)" aria-label="Close the graph" onClick={() => setPanel("graph", false)}>
          <PixelIcon name="close" />
        </button>
      </div>
      <ReactFlowProvider>
        <GraphView key={shape} workflow={workflow} />
      </ReactFlowProvider>
    </div>
  );
}
