import { PixelIcon } from "../hud/PixelIcon";
import { ZoomControl } from "../hud/ZoomControl";
import { replay, seekToPosition, useReplay } from "../state/replayStore";
import { useRunStore } from "../state/runStore";
import { useUiStore } from "../state/uiStore";
import { SPEEDS } from "./ReplayController";

/**
 * The playback strip: play, step, speed, progress, and zoom. Always on screen, beside the
 * icon bar; it folds to a thinner strip that still shows the progress and the zoom.
 */
export function PlaybackBar() {
  const { position, total, playing, speed, streaming } = useReplay();
  const mode = useRunStore((state) => state.mode);
  const expanded = useUiStore((state) => state.panels.playback);
  const toggle = useUiStore((state) => state.toggle);
  const empty = total === 0;

  if (!expanded) {
    return (
      <div className="playback-strip">
        <button className="strip-progress" title="Show the playback controls (B)" aria-label="Show the playback controls" onClick={() => toggle("playback")}>
          <span className="fill" style={{ width: `${empty ? 0 : (position / total) * 100}%` }} />
        </button>
        <span className="counter">
          {position} / {total}
        </span>
        <ZoomControl />
      </div>
    );
  }

  return (
    <div className="playback-bar">
      <button title="Back to start (Home)" aria-label="Back to start" disabled={empty} onClick={() => seekToPosition(0)}>
        <PixelIcon name="start" />
      </button>
      <button title="Previous event (←)" aria-label="Previous event" disabled={position === 0} onClick={() => replay.previous()}>
        <PixelIcon name="previous" />
      </button>
      <button
        className="primary play"
        title={playing ? "Pause (Space)" : "Play (Space)"}
        aria-label={playing ? "Pause" : "Play"}
        disabled={empty && !streaming}
        onClick={() => (playing ? replay.pause() : replay.play())}
      >
        <PixelIcon name={playing ? "pause" : "play"} />
      </button>
      <button title="Next event (→)" aria-label="Next event" disabled={position >= total} onClick={() => replay.next()}>
        <PixelIcon name="next" />
      </button>
      <select
        title="Replay speed (, / .)"
        aria-label="Replay speed"
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
      <button className="icon" title="Fold the playback controls away (B)" aria-label="Fold the playback controls away" onClick={() => toggle("playback")}>
        <PixelIcon name="collapse" />
      </button>
    </div>
  );
}
