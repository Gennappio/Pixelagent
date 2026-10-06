import { useRunStore } from "../state/runStore";
import { useUiStore } from "../state/uiStore";
import { canOpen, ICON_BAR, isLit } from "./barIcons";
import { PixelIcon } from "./PixelIcon";
import { performShortcut } from "./useShortcuts";

/**
 * The icon bar: one icon per window, lit while that window is open, with the key that
 * does the same under it. With the playback strip it is the only part of the interface
 * that is always there: everything else opens from here, and closes again.
 */
export function IconBar() {
  const panels = useUiStore((state) => state.panels);
  const help = useUiStore((state) => state.help);
  const hasRun = useRunStore((state) => state.run !== null);

  return (
    <nav className="icon-bar" aria-label="Windows">
      {ICON_BAR.map((entry) => {
        const nothingToShow = !canOpen(entry.window, hasRun);
        const lit = isLit(entry.window, panels, help) && !nothingToShow;
        return (
          <button
            key={entry.window}
            type="button"
            className={`bar-icon${lit ? " lit" : ""}`}
            aria-pressed={lit}
            aria-label={entry.title}
            disabled={nothingToShow}
            title={nothingToShow ? "Log: only while a run is on screen" : `${entry.title} (${entry.key}): ${entry.description}`}
            onClick={() => performShortcut(entry.action)}
          >
            <PixelIcon name={entry.icon} />
            <kbd>{entry.key}</kbd>
          </button>
        );
      })}
    </nav>
  );
}
