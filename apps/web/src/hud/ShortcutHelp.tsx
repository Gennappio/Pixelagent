import { useUiStore } from "../state/uiStore";
import { PixelIcon } from "./PixelIcon";
import { SHORTCUTS, type ShortcutGroup } from "./shortcuts";

const GROUPS: ShortcutGroup[] = ["Windows", "Playback", "Camera", "Workflow"];

const MOUSE = [
  ["Click", "Inspect a character, a sheet, a tool, a speech bubble"],
  ["Click the floor", "Clear the selection"],
  ["Pinch, or Ctrl / ⌘ + wheel", "Zoom, around the pointer"],
  ["Wheel, or two-finger scroll", "Pan"],
  ["Drag the floor", "Pan"],
  ["Double-click", "Frame the room again"],
];

/** Every keyboard shortcut, straight from the table that implements them. */
export function ShortcutHelp() {
  const setHelp = useUiStore((state) => state.setHelp);
  return (
    <aside className="window help" aria-label="Keyboard shortcuts">
      <header className="window-title">
        <span>Shortcuts</span>
        <kbd>?</kbd>
        <button type="button" className="icon" title="Close (Esc)" aria-label="Close" onClick={() => setHelp(false)}>
          <PixelIcon name="close" />
        </button>
      </header>
      <div className="window-body help-body">
        {GROUPS.map((group) => (
          <section key={group}>
            <h3>{group}</h3>
            <dl>
              {SHORTCUTS.filter((shortcut) => shortcut.group === group).map((shortcut) => (
                <div key={shortcut.label}>
                  <dt>
                    <kbd>{shortcut.label}</kbd>
                  </dt>
                  <dd>{shortcut.description}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
        <section>
          <h3>Mouse and trackpad</h3>
          <dl>
            {MOUSE.map(([gesture, effect]) => (
              <div key={gesture}>
                <dt>{gesture}</dt>
                <dd>{effect}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </aside>
  );
}
