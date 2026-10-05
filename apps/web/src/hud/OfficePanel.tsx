import { useMemo, useRef } from "react";
import { api } from "../api/client";
import { formatTime } from "../debugger/transcript";
import { addAgent, addToolNode } from "../graph/workflowEdits";
import { toolLabel } from "../protocol/workflow";
import { backToBuild } from "../state/actions";
import { useRunStore } from "../state/runStore";
import { useUiStore } from "../state/uiStore";
import { useWorkflowStore } from "../state/workflowStore";
import { buildLayout } from "../world/layout";
import { cssColor, spriteFor } from "../world/sprites";
import { Section } from "./Panel";

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

/**
 * What is in the office: the workflow file, its agents and tools, and the stored runs.
 * Everything that changes the workflow is offered in build mode only.
 */
export function OfficePanel() {
  const { workflow, workflows, tools, dirty, edit, open, save, createNew, importWorkflow } = useWorkflowStore();
  const { runs, run, open: openRun, openExport } = useRunStore();
  const selection = useUiStore((state) => state.selection);
  const select = useUiStore((state) => state.select);
  const setPanel = useUiStore((state) => state.setPanel);

  const building = run === null;
  /** With a run on screen the lists describe what was executed, not what is being edited. */
  const shown = run?.workflow ?? workflow;
  const placed = useMemo(() => buildLayout(shown).tools, [shown]);

  const workflowFile = useJsonFile((data) => {
    if (!Array.isArray(data?.agents) || !Array.isArray(data?.nodes)) return alert("That file is not a workflow.");
    backToBuild();
    importWorkflow(data);
  });
  const runFile = useJsonFile((data) => {
    if (!data?.run?.workflow || !Array.isArray(data?.events)) return alert("That file is not a saved run.");
    openExport(data);
  });

  const confirmDiscard = () => !dirty || confirm("Discard unsaved changes to this workflow?");

  return (
    <>
      <Section id="office.workflow" title="Workflow">
        <select
          value={workflow.id}
          aria-label="Workflow"
          onChange={(event) => {
            if (!confirmDiscard()) return;
            backToBuild();
            void open(event.target.value);
          }}
        >
          {!workflow.id && <option value="">(unsaved)</option>}
          {workflows.map((summary) => (
            <option key={summary.id} value={summary.id}>
              {summary.name}
            </option>
          ))}
        </select>
        {building ? (
          <>
            <input
              value={workflow.name}
              aria-label="Workflow name"
              onChange={(event) => edit((current) => ({ ...current, name: event.target.value }))}
            />
            <div className="button-row">
              <button className={dirty ? "primary" : ""} disabled={!dirty} title="Save (Ctrl S)" onClick={() => void save().catch(() => {})}>
                {dirty ? "Save" : "Saved"}
              </button>
              <button
                onClick={() => {
                  if (confirmDiscard()) createNew();
                }}
              >
                New
              </button>
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
          </>
        ) : (
          <>
            <p className="muted">
              Showing run <code>{run.id}</code> as it was executed.
            </p>
            <label>
              Task
              <div className="readonly">{run.input || "—"}</div>
            </label>
            <button onClick={backToBuild}>◂ Back to BUILD to edit</button>
          </>
        )}
      </Section>

      <Section
        id="office.agents"
        title="Agents"
        actions={
          building && (
            <button
              title="Add an agent to the office"
              onClick={() => {
                const added = addAgent(workflow);
                edit(() => added.workflow);
                select({ kind: "agent", agentId: added.agent.id });
              }}
            >
              +
            </button>
          )
        }
      >
        <ul className="list">
          {shown.agents.map((agent) => (
            <li
              key={agent.id}
              className={`row clickable${selection?.kind === "agent" && selection.agentId === agent.id ? " selected" : ""}`}
              onClick={() => select({ kind: "agent", agentId: agent.id })}
            >
              <span className="dot" style={{ background: cssColor(spriteFor(agent.appearance.sprite).shirt) }} />
              {agent.name} <span className="muted">{agent.role}</span>
            </li>
          ))}
          {shown.agents.length === 0 && <li className="muted">No agents yet.</li>}
        </ul>
        {building && (
          <button className="hint" title="Open the graph (G)" onClick={() => setPanel("graph", true)}>
            Connect agents in the graph <kbd>G</kbd>
          </button>
        )}
      </Section>

      <Section id="office.tools" title="Tools">
        <ul className="list">
          {(building ? tools.map((tool) => tool.name) : placed).map((name) => (
            <li
              key={name}
              className={`row clickable${selection?.kind === "tool" && selection.tool === name ? " selected" : ""}`}
              title={tools.find((tool) => tool.name === name)?.description}
              onClick={() => select({ kind: "tool", tool: name })}
            >
              {toolLabel(name)}
              {building &&
                (placed.includes(name) ? (
                  <span className="tag">in office</span>
                ) : (
                  <button
                    title="Place a station for this tool in the office"
                    onClick={(event) => {
                      event.stopPropagation();
                      edit((current) => addToolNode(current, name).workflow);
                    }}
                  >
                    +
                  </button>
                ))}
            </li>
          ))}
          {!building && placed.length === 0 && <li className="muted">This run used no tools.</li>}
        </ul>
      </Section>

      <Section
        id="office.runs"
        title="Runs"
        actions={
          <>
            <button title="Replay a run from an exported file" onClick={runFile.pick}>
              Open file
            </button>
            {runFile.element}
          </>
        }
      >
        <ul className="list">
          {runs.map((summary) => (
            <li
              key={summary.id}
              className={`row clickable${run?.id === summary.id ? " selected" : ""}`}
              title={summary.input}
              onClick={() => void openRun(summary.id)}
            >
              <span className={`status ${summary.status}`}>{summary.status}</span>
              {formatTime(summary.createdAt)} <span className="muted">{summary.createdAt.slice(0, 10)}</span>
            </li>
          ))}
          {runs.length === 0 && <li className="muted">No runs yet. Press Run.</li>}
        </ul>
        {run && (
          <button onClick={async () => download(`${run.id}.json`, (await api.exportRun(run.id).catch(() => null)) ?? { run, events: [] })}>
            Export this run
          </button>
        )}
      </Section>
    </>
  );
}
