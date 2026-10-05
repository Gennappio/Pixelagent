import { describe, expect, it } from "vitest";
import { demoWorkflow } from "../testing/demoRun";
import { addAgent, canConnect, connect, emptyWorkflow, removeNodes, toggleAgentTool } from "./workflowEdits";

const toolsOf = (workflow: typeof demoWorkflow, agentId: string) =>
  workflow.agents.find((agent) => agent.id === agentId)!.tools.map((tool) => tool.name);

describe("workflow edits", () => {
  it("only allows connections that make sense", () => {
    expect(canConnect(demoWorkflow, "start", "node_search")).toBe(false);
    expect(canConnect(demoWorkflow, "node_search", "node_luca")).toBe(false);
    expect(canConnect(demoWorkflow, "end", "node_anna")).toBe(false);
    expect(canConnect(demoWorkflow, "node_anna", "node_luca")).toBe(false); // already connected
    expect(canConnect(demoWorkflow, "node_anna", "node_search")).toBe(true);
  });

  it("derives an agent's tools from the tool nodes wired to it", () => {
    const wired = connect(demoWorkflow, "node_anna", "node_search");
    expect(toolsOf(wired, "anna")).toEqual(["web_search"]);
  });

  it("toggles a tool on and off, cleaning up the node it created", () => {
    const on = toggleAgentTool(demoWorkflow, "anna", "calculator");
    expect(toolsOf(on, "anna")).toEqual(["calculator"]);
    expect(on.nodes).toHaveLength(demoWorkflow.nodes.length + 1);

    const off = toggleAgentTool(on, "anna", "calculator");
    expect(toolsOf(off, "anna")).toEqual([]);
    expect(off.nodes).toHaveLength(demoWorkflow.nodes.length);
    expect(off.edges).toHaveLength(demoWorkflow.edges.length);
  });

  it("removing an agent node removes the agent and its edges, but never Start/End", () => {
    const result = removeNodes(demoWorkflow, ["node_luca", "start", "end"]);
    expect(result.agents.map((agent) => agent.id)).toEqual(["anna", "gianni"]);
    expect(result.nodes.map((node) => node.id)).toEqual(["start", "node_anna", "node_search", "node_gianni", "node_email", "end"]);
    expect(result.edges.some((edge) => edge.source === "node_luca" || edge.target === "node_luca")).toBe(false);
  });

  it("adds agents with fresh stable ids", () => {
    const first = addAgent(emptyWorkflow());
    const second = addAgent(first.workflow);
    expect(second.workflow.agents).toHaveLength(2);
    expect(first.agent.id).not.toBe(second.agent.id);
    expect(second.workflow.nodes.filter((node) => node.type === "agent")).toHaveLength(2);
  });
});
