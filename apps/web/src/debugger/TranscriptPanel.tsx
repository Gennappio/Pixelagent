import { useEffect, useMemo, useRef } from "react";
import { replay, useReplay } from "../state/replayStore";
import { useUiStore } from "../state/uiStore";
import { eventStage } from "./ReplayController";
import { buildTranscript } from "./transcript";

/** The "verbale": a readable account of the run, one templated sentence per event. */
export function Transcript({ names }: { names: Record<string, string> }) {
  const snapshot = useReplay();
  const { position, total } = snapshot;
  const selection = useUiStore((state) => state.selection);
  const select = useUiStore((state) => state.select);
  const current = useRef<HTMLLIElement>(null);

  // `total` changes whenever the log does (it is replaced, or grows during a live run).
  const lines = useMemo(() => buildTranscript(replay.log, names), [names, total]);

  useEffect(() => {
    current.current?.scrollIntoView({ block: "nearest" });
  }, [position]);

  if (lines.length === 0) {
    return <div className="empty">Run the workflow, or open a past run, to see its transcript.</div>;
  }

  return (
    <ol className="transcript">
      {lines.map((line, index) => {
        const stage = eventStage(snapshot, index);
        const classes = [
          stage === "done" ? "" : stage,
          line.isError ? "error" : "",
          selection?.kind === "event" && selection.eventId === line.eventId ? "selected" : "",
        ];
        return (
          <li
            key={line.eventId}
            ref={index === position - 1 ? current : undefined}
            className={classes.filter(Boolean).join(" ")}
            title="Click to inspect, double-click to jump here"
            onClick={() => select({ kind: "event", eventId: line.eventId })}
            onDoubleClick={() => replay.seek(line.sequence)}
          >
            <time>{line.time}</time>
            <span>{line.text}</span>
          </li>
        );
      })}
    </ol>
  );
}
