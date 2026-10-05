import { useRef } from "react";
import { api } from "./api/client";
import { formatTime } from "./debugger/transcript";
import { addAgent, addToolNode } from "./graph/workflowEdits";
import { toolLabel } from "./protocol/workflow";
import { useRunStore } from "./state/runStore";
import { useUiStore } from "./state/uiStore";
import { useWorkflowStore } from "./state/workflowStore";
import { cssColor, spriteFor } from "./world/sprites";

function download(filename: string, data: unknown): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/** Reads a JSON file picked by the user and hands the parsed content to `onLoad`. */
function useJsonFile(onLoad: (data: any) => void) {
  const input = useRef<HTMLInputElement>(null);
  const element = (
    <input
      ref={input}
      type="file"
      accept="application/json,.json"
      hidden
      onChange={async (event) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;
        try {
          onLoad(JSON.parse(await file.text()));
        } catch {
          alert(`${file.name} is not a valid JSON file.`);
        }
      }}
    />
  );
  return { element, pick: () => input.current?.click() };
}

export function Sidebar() {
  const { workflow, workflows, tools, dirty, edit, open, save, createNew, importWorkflow } = useWorkflowStore();
  const { runs, run, open: openRun, openExport } = useRunStore();
  const selection = useUiStore((state) => state.selection);
  const select = useUiStore((state) => state.select);
  const setView = useUiStore((state) => state.setView);

  const workflowFile = useJsonFile((data) => {
    if (!Array.isArray(data?.agents) || !Array.isArray(data?.nodes)) return alert("That file is not a workflow.");
    importWorkflow(data);
  });
  const runFile = useJsonFile((data) => {
    if (!data?.run?.workflow || !Array.isArray(data?.events)) return alert("That file is not a saved run.");
    openExport(data);
    setView("world");
  });

  const confirmDiscard = () => !dirty || confirm("Discard unsaved changes to this workflow?");

  return (
    <aside className="sidebar">
      <section>
        <h3>Workflow</h3>
        <select
          value={workflow.id}
          onChange={(event) => {
            if (confirmDiscard()) void open(event.target.value);
          }}
        >
          {!workflow.id && <option value="">(unsaved)</option>}
          {workflows.map((summary) => (
            <option key={summary.id} value={summary.id}>
              {summary.name}
            </option>
          ))}
        </select>
        <input
          value={workflow.name}
          aria-label="Workflow name"
          onChange={(event) => edit((current) => ({ ...current, name: event.target.value }))}
        />
        <div className="button-row">
          <button className={dirty ? "primary" : ""} disabled={!dirty} onClick={() => void save().catch(() => {})}>
            {dirty ? "Save" : "Saved"}
          </button>
          <button onClick={() => confirmDiscard() && createNew()}>New</button>
        </div>
        <div className="button-row">
          <button onClick={() => download(`${workflow.name || "workflow"}.json`, workflow)}>Export</button>
          <button onClick={() => confirmDiscard() && workflowFile.pick()}>Import</button>
          {workflowFile.element}
        </div>
        <label>
          Task
          <textarea
            rows={3}
            value={workflow.input}
            placeholder="What the first agent is asked to do"
            onChange={(event) => edit((current) => ({ ...current, input: event.target.value }))}
          />
        </label>
      </section>

      <section>
        <h3>
          Agents
          <button
            title="Add an agent"
            onClick={() => {
              const added = addAgent(workflow);
              edit(() => added.workflow);
              select({ kind: "agent", agentId: added.agent.id });
              setView("graph");
            }}
          >
            +
          </button>
        </h3>
        <ul className="list">
          {workflow.agents.map((agent) => (
            <li
              key={agent.id}
              className={`row clickable${selection?.kind === "agent" && selection.agentId === agent.id ? " selected" : ""}`}
              onClick={() => select({ kind: "agent", agentId: agent.id })}
            >
              <span className="dot" style={{ background: cssColor(spriteFor(agent.appearance.sprite).shirt) }} />
              {agent.name} <span className="muted">{agent.role}</span>
            </li>
          ))}
          {workflow.agents.length === 0 && <li className="muted">No agents yet.</li>}
        </ul>
      </section>

      <section>
        <h3>Tools</h3>
        <ul className="list">
          {tools.map((tool) => (
            <li key={tool.name} className="row" title={tool.description}>
              {toolLabel(tool.name)}
              <button
                title="Add this tool to the graph, then connect an agent to it"
                onClick={() => {
                  edit((current) => addToolNode(current, tool.name).workflow);
                  setView("graph");
                }}
              >
                +
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3>
          Runs
          <button title="Replay a run from an exported file" onClick={runFile.pick}>
            Open file
          </button>
          {runFile.element}
        </h3>
        <ul className="list">
          {runs.map((summary) => (
            <li
              key={summary.id}
              className={`row clickable${run?.id === summary.id ? " selected" : ""}`}
              title={summary.input}
              onClick={() => {
                void openRun(summary.id);
                setView("world");
              }}
            >
              <span className={`status ${summary.status}`}>{summary.status}</span>
              {formatTime(summary.createdAt)} <span className="muted">{summary.createdAt.slice(0, 10)}</span>
            </li>
          ))}
          {runs.length === 0 && <li className="muted">No runs yet. Press Run.</li>}
        </ul>
        {run && (
          <button onClick={async () => download(`${run.id}.json`, await api.exportRun(run.id).catch(() => null) ?? { run, events: [] })}>
            Export this run
          </button>
        )}
      </section>
    </aside>
  );
}
