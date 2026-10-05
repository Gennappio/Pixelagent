import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { Agent } from "../protocol/workflow";
import { toolLabel } from "../protocol/workflow";
import { cssColor, spriteFor } from "../world/sprites";

export type AgentFlowNode = Node<{ agent: Agent; active: boolean }, "agent">;
export type ToolFlowNode = Node<{ tool: string; active: boolean }, "tool">;
export type TerminalFlowNode = Node<Record<string, never>, "start" | "end">;
export type FlowNode = AgentFlowNode | ToolFlowNode | TerminalFlowNode;

/** Handle an agent's tool connections leave from; everything else uses the default handle. */
export const TOOLS_HANDLE = "tools";

// Each node forwards `isConnectable` to its handles: that is how React Flow turns off
// connecting when the graph is read-only (a handle is connectable unless told otherwise).

export function AgentNode({ data, selected, isConnectable }: NodeProps<AgentFlowNode>) {
  const { agent, active } = data;
  const palette = spriteFor(agent.appearance.sprite);
  return (
    <div className={`flow-node agent-node${selected ? " selected" : ""}${active ? " active" : ""}`}>
      <Handle type="target" position={Position.Top} isConnectable={isConnectable} />
      <span className="avatar" style={{ background: cssColor(palette.shirt), borderColor: cssColor(palette.hair) }} />
      <div>
        <div className="node-title">{agent.name}</div>
        <div className="node-subtitle">{agent.role || "Agent"}</div>
      </div>
      <Handle type="source" position={Position.Bottom} isConnectable={isConnectable} />
      <Handle type="source" position={Position.Right} id={TOOLS_HANDLE} className="tools-handle" isConnectable={isConnectable} />
    </div>
  );
}

export function ToolNode({ data, selected, isConnectable }: NodeProps<ToolFlowNode>) {
  return (
    <div className={`flow-node tool-node${selected ? " selected" : ""}${data.active ? " active" : ""}`}>
      <Handle type="target" position={Position.Left} isConnectable={isConnectable} />
      <div className="node-title">{toolLabel(data.tool)}</div>
      <div className="node-subtitle">tool</div>
    </div>
  );
}

export function StartNode({ isConnectable }: NodeProps<TerminalFlowNode>) {
  return (
    <div className="flow-node terminal-node">
      START
      <Handle type="source" position={Position.Bottom} isConnectable={isConnectable} />
    </div>
  );
}

export function EndNode({ isConnectable }: NodeProps<TerminalFlowNode>) {
  return (
    <div className="flow-node terminal-node">
      <Handle type="target" position={Position.Top} isConnectable={isConnectable} />
      END
    </div>
  );
}

export const nodeTypes = { agent: AgentNode, tool: ToolNode, start: StartNode, end: EndNode };
