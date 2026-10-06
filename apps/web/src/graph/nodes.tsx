import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { Agent, WorkflowTable } from "../protocol/workflow";
import { toolLabel } from "../protocol/workflow";
import { cssColor, spriteFor } from "../world/sprites";

export type AgentFlowNode = Node<{ agent: Agent; active: boolean }, "agent">;
export type ToolFlowNode = Node<{ tool: string; active: boolean }, "tool">;
export type TableFlowNode = Node<{ table: WorkflowTable }, "table">;
export type TerminalFlowNode = Node<Record<string, never>, "start" | "end">;
export type FlowNode = AgentFlowNode | ToolFlowNode | TableFlowNode | TerminalFlowNode;

// The graph is a picture of the relations, not a way to change them: no handle can be connected.

export function AgentNode({ data, selected }: NodeProps<AgentFlowNode>) {
  const { agent, active } = data;
  const palette = spriteFor(agent.appearance.sprite);
  return (
    <div className={`flow-node agent-node${selected ? " selected" : ""}${active ? " active" : ""}`}>
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <span className="avatar" style={{ background: cssColor(palette.shirt), borderColor: cssColor(palette.hair) }} />
      <div>
        <div className="node-title">{agent.name}</div>
        <div className="node-subtitle">{agent.role || "Agent"}</div>
      </div>
      <Handle type="source" position={Position.Right} isConnectable={false} />
      <Handle type="source" position={Position.Bottom} id="below" isConnectable={false} />
    </div>
  );
}

export function ToolNode({ data, selected }: NodeProps<ToolFlowNode>) {
  return (
    <div className={`flow-node tool-node${selected ? " selected" : ""}${data.active ? " active" : ""}`}>
      <Handle type="target" position={Position.Top} isConnectable={false} />
      <div className="node-title">{toolLabel(data.tool)}</div>
      <div className="node-subtitle">tool</div>
    </div>
  );
}

export function TableNode({ data, selected }: NodeProps<TableFlowNode>) {
  return (
    <div className={`flow-node table-node${selected ? " selected" : ""}`}>
      <Handle type="target" position={Position.Top} isConnectable={false} />
      <div className="node-title">{data.table.name || data.table.id}</div>
      <div className="node-subtitle">{data.table.mode === "pile" ? "pile" : "table"}</div>
    </div>
  );
}

export function StartNode() {
  return (
    <div className="flow-node terminal-node">
      START
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
}

export function EndNode() {
  return (
    <div className="flow-node terminal-node">
      <Handle type="target" position={Position.Left} isConnectable={false} />
      END
    </div>
  );
}

export const nodeTypes = { agent: AgentNode, tool: ToolNode, table: TableNode, start: StartNode, end: EndNode };
