import {
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  Controls,
  ReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useState } from "react";
import type { Workflow } from "../protocol/workflow";
import { replay, useReplay } from "../state/replayStore";
import { useUiStore, type Selection } from "../state/uiStore";
import { useWorkflowStore } from "../state/workflowStore";
import { nodeTypes, TOOLS_HANDLE, type FlowNode } from "./nodes";
import { canConnect, connect, moveNode, removeEdges, removeNodes } from "./workflowEdits";

interface Activity {
  agentId?: string;
  tool?: string;
}

function toFlowNodes(workflow: Workflow, selection: Selection, activity: Activity, previous: FlowNode[]): FlowNode[] {
  const known = new Map(previous.map((node) => [node.id, node]));
  return workflow.nodes.flatMap((node): FlowNode[] => {
    // Carry over what React Flow measured, so re-deriving nodes does not re-measure them.
    const base = { id: node.id, position: node.position, measured: known.get(node.id)?.measured };
    if (node.type === "agent") {
      const agent = workflow.agents.find((candidate) => candidate.id === node.agentId);
      if (!agent) return [];
      return [
        {
          ...base,
          type: "agent",
          data: { agent, active: activity.agentId === agent.id },
          selected: selection?.kind === "agent" && selection.agentId === agent.id,
        },
      ];
    }
    if (node.type === "tool") {
      const tool = node.tool ?? "";
      const active = activity.tool === tool && workflow.agents.some((a) => a.id === activity.agentId && a.tools.some((t) => t.name === tool));
      return [{ ...base, type: "tool", data: { tool, active }, selected: known.get(node.id)?.selected }];
    }
    return [{ ...base, type: node.type, data: {}, deletable: false }];
  });
}

function toFlowEdges(workflow: Workflow, previous: Edge[]): Edge[] {
  const selected = new Set(previous.filter((edge) => edge.selected).map((edge) => edge.id));
  const toolNodes = new Set(workflow.nodes.filter((node) => node.type === "tool").map((node) => node.id));
  return workflow.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: toolNodes.has(edge.target) ? TOOLS_HANDLE : null,
    className: toolNodes.has(edge.target) ? "tool-edge" : undefined,
    selected: selected.has(edge.id),
  }));
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

export function WorkflowEditor() {
  const workflow = useWorkflowStore((state) => state.workflow);
  const edit = useWorkflowStore((state) => state.edit);
  const selection = useUiStore((state) => state.selection);
  const select = useUiStore((state) => state.select);
  const { agentId: activeAgent, tool: activeTool } = useActivity();

  // React Flow owns transient state (drag positions, measurements); the workflow store owns the document.
  const [nodes, setNodes] = useState<FlowNode[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);

  useEffect(() => {
    setNodes((previous) => toFlowNodes(workflow, selection, { agentId: activeAgent, tool: activeTool }, previous));
  }, [workflow, selection, activeAgent, activeTool]);

  useEffect(() => {
    setEdges((previous) => toFlowEdges(workflow, previous));
  }, [workflow]);

  const onNodesChange = useCallback(
    (changes: NodeChange<FlowNode>[]) => {
      setNodes((current) => applyNodeChanges(changes, current));
      for (const change of changes) {
        if (change.type === "position" && change.position && change.dragging === false) {
          const { id, position } = change;
          edit((current) => moveNode(current, id, position));
        }
      }
      const removed = changes.flatMap((change) => (change.type === "remove" ? [change.id] : []));
      if (removed.length > 0) {
        edit((current) => removeNodes(current, removed));
        select(null);
      }
    },
    [edit, select],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      setEdges((current) => applyEdgeChanges(changes, current));
      const removed = changes.flatMap((change) => (change.type === "remove" ? [change.id] : []));
      if (removed.length > 0) edit((current) => removeEdges(current, removed));
    },
    [edit],
  );

  const isValidConnection = useCallback(
    (connection: Connection | Edge) => {
      if (!canConnect(workflow, connection.source, connection.target)) return false;
      // The side handle is for tools only; the bottom handle is for the next step.
      const toTool = workflow.nodes.some((node) => node.id === connection.target && node.type === "tool");
      return toTool === (connection.sourceHandle === TOOLS_HANDLE);
    },
    [workflow],
  );

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={(connection) => edit((current) => connect(current, connection.source, connection.target))}
      isValidConnection={isValidConnection}
      onNodeClick={(_, node) => {
        if (node.type === "agent") select({ kind: "agent", agentId: node.data.agent.id });
        else if (node.type === "tool") select({ kind: "tool", tool: node.data.tool });
      }}
      onPaneClick={() => select(null)}
      colorMode="dark"
      fitView
      fitViewOptions={{ maxZoom: 1, padding: 0.2 }}
      deleteKeyCode={["Backspace", "Delete"]}
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={24} />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}
