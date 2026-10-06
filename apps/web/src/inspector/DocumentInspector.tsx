import { useMemo, useState } from "react";
import { foldDocuments, latestVersion } from "../protocol/documents";
import { replay, useReplay } from "../state/replayStore";
import { useUiStore } from "../state/uiStore";
import { contentText, describePlace, describeTouch } from "./documentView";

interface Props {
  documentId: string;
  /** Agent and table names by id. */
  names: Record<string, string>;
}

/**
 * A sheet: what it says, every version of it, where it is and everyone who touched it.
 * All "as of the playhead": step back in the run and the sheet steps back too.
 */
export function DocumentInspector({ documentId, names }: Props) {
  const { position, total } = useReplay();
  const select = useUiStore((state) => state.select);
  /** The version on show; null follows the latest. */
  const [picked, setPicked] = useState<number | null>(null);
  // `total` changes whenever the log does (it is replaced, or grows during a live run).
  const registry = useMemo(() => foldDocuments(replay.log.slice(0, position)), [position, total]);
  const record = registry.documents[documentId];

  const selectEventAt = (sequence: number | undefined) => {
    const event = replay.log.find((candidate) => candidate.sequence === sequence);
    if (event) select({ kind: "event", eventId: event.id });
  };

  if (!record) {
    const written = foldDocuments(replay.log).documents[documentId]?.versions[0]?.createdSequence;
    return (
      <div className="inspector">
        <h2>
          <span className="sheet-icon" />
          Sheet <small>{documentId}</small>
        </h2>
        <p className="muted">This sheet has not been written yet at this point of the run.</p>
        {written !== undefined && <button onClick={() => replay.seek(written)}>Jump to where it is written</button>}
      </div>
    );
  }

  const shown = record.versions.find((candidate) => candidate.version === picked) ?? latestVersion(record);
  const text = contentText(shown.content);

  return (
    <div className="inspector">
      <h2>
        <span className="sheet-icon" />
        {shown.title || "Sheet"} <small>{record.versions.length > 1 ? `v${shown.version}` : "sheet"}</small>
      </h2>

      {record.versions.length > 1 && (
        <nav className="tabs" aria-label="Versions">
          {record.versions.map((candidate) => (
            <button
              key={candidate.version}
              className={candidate.version === shown.version ? "active" : ""}
              onClick={() => setPicked(candidate.version)}
            >
              v{candidate.version}
            </button>
          ))}
        </nav>
      )}

      <div className="sheet-content">{text || <span className="muted">(empty)</span>}</div>

      <dl className="fields">
        <div className="field">
          <dt>Where it is now</dt>
          <dd>{describePlace(record.place, names)}</dd>
        </div>
        <div className="field">
          <dt>{record.versions.length > 1 ? `Version ${shown.version} written by` : "Written by"}</dt>
          <dd>
            {shown.authorId ? (names[shown.authorId] ?? shown.authorId) : "You, as the task of the run"}
            {shown.createdSequence !== undefined && (
              <>
                {" "}
                <button className="link" onClick={() => selectEventAt(shown.createdSequence)}>
                  event #{shown.createdSequence}
                </button>
              </>
            )}
          </dd>
        </div>
        <div className="field">
          <dt>History</dt>
          <dd>
            <ol className="list">
              {record.history.map((touch, index) => (
                <li key={index} className="row clickable" onClick={() => selectEventAt(touch.sequence)}>
                  <span className="muted">#{touch.sequence}</span> {describeTouch(touch, names)}
                </li>
              ))}
            </ol>
          </dd>
        </div>
        <div className="field">
          <dt>Id</dt>
          <dd className="muted">{record.id}</dd>
        </div>
      </dl>
    </div>
  );
}
