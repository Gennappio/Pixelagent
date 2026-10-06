import { describe, expect, it } from "vitest";
import { demoWorkflow, parallelWorkflow, tablesWorkflow } from "../testing/demoRun";
import { agentNode, deriveGraph, tableNode, toolNode } from "./deriveGraph";

const edgesOf = (workflow: typeof demoWorkflow) => deriveGraph(workflow).edges.map((edge) => `${edge.source} -${edge.verb}-> ${edge.target}`);

describe("deriveGraph", () => {
  it("draws the demo as a chain from START to END, with each tool below its user", () => {
    const { nodes } = deriveGraph(demoWorkflow);
    expect(nodes.map((node) => node.id)).toEqual(["agent:anna", "agent:luca", "agent:gianni", "tool:web_search", "tool:send_email", "start", "end"]);
    expect(edgesOf(demoWorkflow)).toEqual([
      "start -is_entry-> agent:anna",
      "agent:anna -sends_to-> agent:luca",
      "agent:luca -uses_tool-> tool:web_search",
      "agent:luca -sends_to-> agent:gianni",
      "agent:gianni -uses_tool-> tool:send_email",
      "agent:gianni -is_exit-> end",
    ]);
  });

  it("has exactly one edge per relation, with the relation's id", () => {
    for (const workflow of [demoWorkflow, tablesWorkflow, parallelWorkflow]) {
      expect(deriveGraph(workflow).edges.map((edge) => edge.id)).toEqual(workflow.relations.map((relation) => relation.id));
    }
  });

  it("lays agents out left to right by how many hand-offs they are from the entry", () => {
    const at = Object.fromEntries(deriveGraph(parallelWorkflow).nodes.map((node) => [node.id, node.position]));
    expect(at[agentNode("anna")].x).toBeLessThan(at[agentNode("luca")].x);
    expect(at[agentNode("luca")].x).toBe(at[agentNode("gianni")].x); // both one step from Anna
    expect(at[agentNode("luca")].y).not.toBe(at[agentNode("gianni")].y);
    expect(at[agentNode("gianni")].x).toBeLessThan(at[agentNode("marta")].x);
    expect(at.start.x).toBeLessThan(at[agentNode("anna")].x);
    expect(at.end.x).toBeGreaterThan(at[agentNode("marta")].x);
  });

  it("gives no two nodes the same place", () => {
    for (const workflow of [demoWorkflow, tablesWorkflow, parallelWorkflow]) {
      const places = deriveGraph(workflow).nodes.map((node) => `${node.position.x},${node.position.y}`);
      expect(new Set(places).size).toBe(places.length);
    }
  });

  it("draws tables, and what is done at them", () => {
    const graph = deriveGraph(tablesWorkflow);
    expect(graph.nodes.filter((node) => node.kind === "table").map((node) => node.id)).toEqual([tableNode("todo"), tableNode("done"), tableNode("board")]);
    expect(edgesOf(tablesWorkflow)).toContain("agent:luca -takes_from_table-> table:todo");
    expect(edgesOf(tablesWorkflow)).toContain("agent:gianni -reads_table-> table:board");
    expect(graph.nodes.some((node) => node.id === toolNode("web_search"))).toBe(true);
  });

  it("labels each edge with its verb's phrase and marks the ones left to the agent", () => {
    const optional = { ...demoWorkflow, relations: demoWorkflow.relations.map((relation) => (relation.id === "r2" ? { ...relation, required: false } : relation)) };
    const edge = deriveGraph(optional).edges.find((candidate) => candidate.id === "r2")!;
    expect(edge).toMatchObject({ label: "hands to", optional: true });
    expect(deriveGraph(demoWorkflow).edges.find((candidate) => candidate.id === "r2")!.optional).toBe(false);
  });

  it("draws a tool the agent may use as its choice, and one it consults first as something that always happens", () => {
    const tool = (workflow: typeof demoWorkflow, subject: string) => deriveGraph(workflow).edges.find((edge) => edge.verb === "uses_tool" && edge.source === `agent:${subject}`)!;
    // In the demo Luca chooses to search; on the supplier board the workflow has him consult the search first.
    expect(tool(demoWorkflow, "luca")).toMatchObject({ label: "can use", optional: true });
    expect(tool(tablesWorkflow, "luca")).toMatchObject({ label: "consults first", optional: false });
    expect(tool(tablesWorkflow, "gianni")).toMatchObject({ label: "can use", optional: true });
  });

  it("draws an office nobody has wired up: agents, and nothing between them", () => {
    const bare = { ...demoWorkflow, relations: [] };
    const graph = deriveGraph(bare);
    expect(graph.edges).toEqual([]);
    expect(graph.nodes.map((node) => node.kind)).toEqual(["agent", "agent", "agent"]);
  });

  it("is the same every time", () => {
    expect(deriveGraph(tablesWorkflow)).toEqual(deriveGraph(tablesWorkflow));
  });
});
