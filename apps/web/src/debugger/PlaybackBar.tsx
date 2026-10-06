import { ZoomControl } from "../hud/ZoomControl";
import { replay, seekToPosition, useReplay } from "../state/replayStore";
import { useRunStore } from "../state/runStore";
import { useUiStore } from "../state/uiStore";
import { SPEEDS } from "./ReplayController";

/** Transport controls. Always on screen; collapses to a thin strip that still shows progress. */
export function PlaybackBar() {
  const { position, total, playing, speed, streaming } = useReplay();
  const mode = useRunStore((state) => state.mode);
  const expanded = useUiStore((state) => state.panels.playback);
  const timeline = useUiStore((state) => state.panels.timeline);
  const toggle = useUiStore((state) => state.toggle);
  const empty = total === 0;

  if (!expanded) {
    return (
      <div className="playback-strip">
        <button className="strip-progress" title="Show the playback bar (B)" onClick={() => toggle("playback")}>
          <span className="fill" style={{ width: `${empty ? 0 : (position / total) * 100}%` }} />
          <span className="label">
            {position} / {total}
          </span>
        </button>
        <ZoomControl />
      </div>
    );
  }

  return (
    <div className="playback-bar">
      <button title="Back to start (Home)" disabled={empty} onClick={() => seekToPosition(0)}>
        ⏮
      </button>
      <button title="Previous event (←)" disabled={position === 0} onClick={() => replay.previous()}>
        ◀
      </button>
      <button
        className="primary"
        title={playing ? "Pause (Space)" : "Play (Space)"}
        disabled={empty && !streaming}
        onClick={() => (playing ? replay.pause() : replay.play())}
      >
        {playing ? "⏸" : "▶"}
      </button>
      <button title="Next event (→)" disabled={position >= total} onClick={() => replay.next()}>
        ▶|
      </button>
      <select
        title="Replay speed (, / .)"
        value={speed}
        onChange={(event) => {
          replay.setSpeed(Number(event.target.value));
          event.target.blur(); // hand the keyboard back to the shortcuts
        }}
      >
        {SPEEDS.map((option) => (
          <option key={option} value={option}>
            {option}x
          </option>
        ))}
      </select>
      <input
        type="range"
        aria-label="Playhead"
        min={0}
        max={total}
        value={position}
        disabled={empty}
        onChange={(event) => seekToPosition(Number(event.target.value))}
      />
      <span className="counter">
        {position} / {total}
      </span>
      <span className={`badge ${mode === "build" ? "" : streaming ? "live" : "replay"}`}>
        {mode === "build" ? "NO RUN" : streaming ? (position < total ? "LIVE · buffering" : "LIVE") : "REPLAY"}
      </span>
      <ZoomControl />
      <button className={timeline ? "active" : ""} aria-pressed={timeline} title="Timeline (T)" onClick={() => toggle("timeline")}>
        Timeline <kbd>T</kbd>
      </button>
      <button className="icon" title="Collapse the playback bar (B)" aria-label="Collapse the playback bar" onClick={() => toggle("playback")}>
        ▁
      </button>
    </div>
  );
}
