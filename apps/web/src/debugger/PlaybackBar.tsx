import { replay, useReplay } from "../state/replayStore";
import { useRunStore } from "../state/runStore";
import { SPEEDS } from "./ReplayController";

/** Moves the playhead to just after the n-th event (0 = before the first). */
export function seekToPosition(position: number): void {
  replay.seek(position === 0 ? 0 : replay.log[position - 1].sequence);
}

export function PlaybackBar() {
  const { position, total, playing, speed, streaming } = useReplay();
  const mode = useRunStore((state) => state.mode);
  const empty = total === 0;

  return (
    <div className="playback-bar">
      <button title="Back to start" disabled={empty} onClick={() => seekToPosition(0)}>
        ⏮
      </button>
      <button title="Previous event" disabled={position === 0} onClick={() => replay.previous()}>
        ◀
      </button>
      <button
        className="primary"
        title={playing ? "Pause" : "Play"}
        disabled={empty && !streaming}
        onClick={() => (playing ? replay.pause() : replay.play())}
      >
        {playing ? "⏸" : "▶"}
      </button>
      <button title="Next event" disabled={position >= total} onClick={() => replay.next()}>
        ▶|
      </button>
      <select title="Replay speed" value={speed} onChange={(event) => replay.setSpeed(Number(event.target.value))}>
        {SPEEDS.map((option) => (
          <option key={option} value={option}>
            {option}x
          </option>
        ))}
      </select>
      <input
        type="range"
        min={0}
        max={total}
        value={position}
        disabled={empty}
        onChange={(event) => seekToPosition(Number(event.target.value))}
      />
      <span className="counter">
        {position} / {total}
      </span>
      {mode !== "idle" && (
        <span className={`badge ${streaming ? "live" : "replay"}`}>
          {streaming ? (position < total ? "LIVE · buffering" : "LIVE") : "REPLAY"}
        </span>
      )}
    </div>
  );
}
