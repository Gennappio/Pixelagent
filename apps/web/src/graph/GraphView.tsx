import { Background, BackgroundVariant, Controls, MarkerType, ReactFlow, type Edge } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useMemo } from "react";
import type { Workflow } from "../protocol/workflow";
import { replay, useReplay } from "../state/replayStore";
import { useUiStore } from "../state/uiStore";
import { deriveGraph } from "./deriveGraph";
import { nodeTypes, type FlowNode } from "./nodes";

interface Activity {
  agentId?: string;
  tool?: string;
}

/** What the run is doing right now, so the graph can highlight it. Read from events, like everything else. */
function useActivity(): Activity {
  useReplay();
  const event = replay.currentEvent;
  if (!event || event.type === "RUN_FINISHED" || event.type === "AGENT_FINISHED") return {};
  return {
    agentId: event.actorId,
    tool: event.type === "TOOL_CALL" ? String(event.payload.tool ?? "") : undefined,
  };
}

/**
 * The workflow as a node graph, derived from its relations. It is a picture for review:
 * clicking a node inspects it, and nothing in it can be moved, connected or deleted.
 * What an agent does is changed where the agent is, in its inspector.
 */
export function GraphView({ workflow }: { workflow: Workflow }) {
  const selection = useUiStore((state) => state.selection);
  const select = useUiStore((state) => state.select);
  const { agentId: activeAgent, tool: activeTool } = useActivity();
  const graph = useMemo(() => deriveGraph(workflow), [workflow]);

  const nodes = useMemo(
    () =>
      graph.nodes.flatMap((node): FlowNode[] => {
        const base = { id: node.id, position: node.position };
        if (node.kind === "agent") {
          const agent = workflow.agents.find((candidate) => candidate.id === node.agentId);
          if (!agent) return [];
          const selected = selection?.kind === "agent" && selection.agentId === agent.id;
          return [{ ...base, type: "agent", data: { agent, active: activeAgent === agent.id }, selected }];
        }
        if (node.kind === "tool") {
          const selected = selection?.kind === "tool" && selection.tool === node.tool;
          return [{ ...base, type: "tool", data: { tool: node.tool, active: activeTool === node.tool }, selected }];
        }
        if (node.kind === "table") {
          const table = workflow.tables.find((candidate) => candidate.id === node.tableId);
          if (!table) return [];
          return [{ ...base, type: "table", data: { table }, selected: selection?.kind === "table" && selection.tableId === table.id }];
        }
        return [{ ...base, type: node.kind, data: {} }];
      }),
    [graph, workflow, selection, activeAgent, activeTool],
  );

  const edges = useMemo(
    () =>
      graph.edges.map(
        (edge): Edge => ({
          id: edge.id,
          source: edge.source,
          target: edge.target,
          // Tools and tables hang below the agents; hand-offs run left to right.
          sourceHandle: edge.verb === "sends_to" || edge.verb === "waits_for" || edge.verb === "is_exit" ? null : edge.verb === "is_entry" ? null : "below",
          label: edge.label || undefined,
          className: `edge-${edge.verb}${edge.optional ? " edge-optional" : ""}`,
          markerEnd: { type: MarkerType.ArrowClosed },
        }),
      ),
    [graph],
  );

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodeClick={(_, node) => {
        if (node.type === "agent") select({ kind: "agent", agentId: node.data.agent.id });
        else if (node.type === "tool") select({ kind: "tool", tool: node.data.tool });
        else if (node.type === "table") select({ kind: "table", tableId: node.data.table.id });
      }}
      onPaneClick={() => select(null)}
      nodesDraggable={false}
      nodesConnectable={false}
      edgesFocusable={false}
      deleteKeyCode={null}
      // Arrow keys belong to the replay controls, not to nudging nodes.
      disableKeyboardA11y
      colorMode="dark"
      fitView
      fitViewOptions={{ maxZoom: 1, padding: 0.2 }}
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={24} variant={BackgroundVariant.Lines} color="rgba(127, 178, 255, 0.09)" />
      <Controls showInteractive={false} position="bottom-right" />
    </ReactFlow>
  );
}
