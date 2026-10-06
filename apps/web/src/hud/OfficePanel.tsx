import { useMemo, useRef } from "react";
import { api } from "../api/client";
import { addAgent, addTable } from "../build/workflowEdits";
import { formatTime } from "../debugger/transcript";
import { describePlace } from "../inspector/documentView";
import { foldDocuments, latestVersion } from "../protocol/documents";
import { toolsInUse, whyNotRunnable } from "../protocol/relations";
import { namesOf, toolLabel } from "../protocol/workflow";
import { backToBuild } from "../state/actions";
import { replay, useReplay } from "../state/replayStore";
import { useRunStore } from "../state/runStore";
import { useUiStore } from "../state/uiStore";
import { useWorkflowStore } from "../state/workflowStore";
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
 * The workflow as a file: its name, its task, what it still lacks before it can run, what
 * adds things to the office, and the stored runs. The office itself is built on the
 * characters, in the world. With a run on screen the panel lists what that run had in it:
 * agents, tools, tables and every sheet.
 */
export function OfficePanel() {
  const { workflow, workflows, tools, dirty, edit, open, save, createNew, importWorkflow } = useWorkflowStore();
  const { runs, run, open: openRun, openExport } = useRunStore();
  const selection = useUiStore((state) => state.selection);
  const select = useUiStore((state) => state.select);
  const openMenu = useUiStore((state) => state.openMenu);

  const building = run === null;
  /** With a run on screen the lists describe what was executed, not what is being edited. */
  const shown = run?.workflow ?? workflow;
  const inUse = useMemo(() => toolsInUse(shown), [shown]);
  const names = useMemo(() => namesOf(shown), [shown]);
  const missing = useMemo(() => whyNotRunnable(workflow, tools), [workflow, tools]);
  // Every sheet of the run as of the playhead, filed ones included: those are out of
  // sight in the world, and this list is how to get back to them.
  const { position, total } = useReplay();
  const sheets = useMemo(() => {
    const registry = foldDocuments(replay.log.slice(0, position));
    return registry.order.map((id) => registry.documents[id]);
  }, [position, total]);

  const workflowFile = useJsonFile((data) => {
    // A workflow of today has relations; one from before them had a graph, and is read all the same.
    if (!Array.isArray(data?.agents) || !(Array.isArray(data?.relations) || Array.isArray(data?.nodes))) return alert("That file is not a workflow.");
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
                placeholder="What the entry agent is asked to do"
                onChange={(event) => edit((current) => ({ ...current, input: event.target.value }))}
              />
            </label>
            {missing.map((reason) => (
              <p key={reason} className="notice">
                {reason}
              </p>
            ))}
            <div className="button-row add-things">
              <button
                title="Add a character to the office"
                onClick={() => {
                  const added = addAgent(workflow);
                  edit(() => added.workflow);
                  openMenu({ kind: "agent", agentId: added.agent.id });
                }}
              >
                + character
              </button>
              <button
                title="Add a shared table: sheets on it are read and rewritten"
                onClick={() => {
                  const added = addTable(workflow, "shared");
                  edit(() => added.workflow);
                  openMenu({ kind: "table", tableId: added.table.id });
                }}
              >
                + table
              </button>
              <button
                title="Add a pile: sheets on it are taken one at a time"
                onClick={() => {
                  const added = addTable(workflow, "pile");
                  edit(() => added.workflow);
                  openMenu({ kind: "table", tableId: added.table.id });
                }}
              >
                + pile
              </button>
            </div>
            <p className="muted">
              Or click the floor where you want one. Click a character to say what it does, and drag anything to move it.
            </p>
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

      {!building && (
        <>
          <Section id="office.agents" title="Agents">
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
              {shown.agents.length === 0 && <li className="muted">No agents.</li>}
            </ul>
          </Section>

          <Section id="office.tools" title="Tools">
            <ul className="list">
              {inUse.map((name) => (
                <li
                  key={name}
                  className={`row clickable${selection?.kind === "tool" && selection.tool === name ? " selected" : ""}`}
                  title={tools.find((tool) => tool.name === name)?.description}
                  onClick={() => select({ kind: "tool", tool: name })}
                >
                  {toolLabel(name)}
                </li>
              ))}
              {inUse.length === 0 && <li className="muted">This run used no tools.</li>}
            </ul>
          </Section>

          {shown.tables.length > 0 && (
            <Section id="office.tables" title="Tables">
              <ul className="list">
                {shown.tables.map((table) => (
                  <li
                    key={table.id}
                    className={`row clickable${selection?.kind === "table" && selection.tableId === table.id ? " selected" : ""}`}
                    onClick={() => select({ kind: "table", tableId: table.id })}
                  >
                    {table.name || table.id}
                    <span className="tag">{table.mode === "pile" ? "pile" : "shared"}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </>
      )}

      {!building && (
        <Section id="office.sheets" title="Sheets">
          <ul className="list">
            {sheets.map((record) => (
              <li
                key={record.id}
                className={`row clickable sheet-row${selection?.kind === "document" && selection.documentId === record.id ? " selected" : ""}`}
                title={describePlace(record.place, names)}
                onClick={() => select({ kind: "document", documentId: record.id })}
              >
                <span className={`sheet-icon${record.place.kind === "filed" ? " filed" : ""}`} />
                <span className="sheet-title">
                  {latestVersion(record).title || record.id}
                  {record.versions.length > 1 && <small> v{latestVersion(record).version}</small>}
                </span>
                <span className="tag">{describePlace(record.place, names)}</span>
              </li>
            ))}
            {sheets.length === 0 && <li className="muted">No sheets yet at this point of the run.</li>}
          </ul>
        </Section>
      )}

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
