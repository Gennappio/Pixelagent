import { useMemo } from "react";
import { removeTable, updateTable } from "../build/workflowEdits";
import { foldDocuments, latestVersion } from "../protocol/documents";
import { sentence, verbInfo } from "../protocol/relations";
import type { Workflow, WorkflowTable } from "../protocol/workflow";
import { replay, useReplay } from "../state/replayStore";
import { useUiStore } from "../state/uiStore";
import { useWorkflowStore } from "../state/workflowStore";
import { excerpt } from "./documentView";

interface Props {
  /** The workflow on screen: the one being built, or the one a run executed. */
  workflow: Workflow;
  table: WorkflowTable;
  /** Build mode: the table can be changed. */
  editable: boolean;
}

/** A table: what kind it is, who uses it, and (in a run) what is lying on it at the playhead. */
export function TableInspector({ workflow, table, editable }: Props) {
  const edit = useWorkflowStore((state) => state.edit);
  const select = useUiStore((state) => state.select);
  const { position, total } = useReplay();
  const onIt = useMemo(() => {
    const registry = foldDocuments(replay.log.slice(0, position));
    return (registry.tables[table.id] ?? []).map((id) => registry.documents[id]);
  }, [position, total, table.id]);
  const users = workflow.relations.filter((relation) => relation.object === table.id && verbInfo(relation.verb).objectKind === "table");

  return (
    <div className="inspector">
      <h2>
        {table.name || table.id} <small>{table.mode === "pile" ? "pile" : "table"}</small>
      </h2>
      {editable ? (
        <form className="form" onSubmit={(event) => event.preventDefault()}>
          <label>
            Name
            <input value={table.name} onChange={(event) => edit((current) => updateTable(current, table.id, { name: event.target.value }))} />
          </label>
          <label>
            Kind
            <select value={table.mode} onChange={(event) => edit((current) => updateTable(current, table.id, { mode: event.target.value as WorkflowTable["mode"] }))}>
              <option value="shared">Shared table: sheets are read and rewritten</option>
              <option value="pile">Pile: sheets are taken, one at a time</option>
            </select>
            <small>
              {table.mode === "pile"
                ? "Every write adds a sheet. An agent that takes from it gets one per turn, oldest first."
                : "One sheet per title: writing it again makes a new version, and readers see the latest."}
            </small>
          </label>
        </form>
      ) : (
        <p className="muted">{table.mode === "pile" ? "A pile: sheets are taken from it one at a time." : "A shared table: its sheets are read and rewritten."}</p>
      )}

      <h3>Who uses it</h3>
      {users.length === 0 ? (
        <p className="muted">{editable ? "Nobody yet. Click a character and say that it reads, writes on or takes from it." : "Nobody."}</p>
      ) : (
        <ul className="list">
          {users.map((relation) => (
            <li key={relation.id} className="row clickable" onClick={() => select({ kind: "agent", agentId: relation.subject })}>
              {sentence(workflow, relation)}
            </li>
          ))}
        </ul>
      )}

      {!editable && (
        <>
          <h3>On it now</h3>
          {onIt.length === 0 ? (
            <p className="muted">Nothing at this point of the run.</p>
          ) : (
            <ul className="list">
              {onIt.map((record) => (
                <li key={record.id} className="row clickable" onClick={() => select({ kind: "document", documentId: record.id })}>
                  <strong>
                    <span className="sheet-icon" />
                    {latestVersion(record).title || record.id}
                    {record.versions.length > 1 && <small> v{latestVersion(record).version}</small>}
                  </strong>
                  <div>{excerpt(latestVersion(record).content, 80)}</div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {editable && (
        <div className="button-row">
          <button
            className="danger"
            onClick={() => {
              if (users.length > 0 && !confirm(`Remove ${table.name || table.id}, with the ${users.length} sentence(s) that use it?`)) return;
              edit((current) => removeTable(current, table.id));
              select(null);
            }}
          >
            Remove this {table.mode === "pile" ? "pile" : "table"}
          </button>
        </div>
      )}
      <small className="muted">id: {table.id}</small>
    </div>
  );
}
