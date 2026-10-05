import { useUiStore } from "../state/uiStore";
import { SHORTCUTS, type ShortcutGroup } from "./shortcuts";

const GROUPS: ShortcutGroup[] = ["Panels", "Playback", "Workflow"];

const MOUSE = [
  ["Click", "Inspect a character, a tool, a speech bubble"],
  ["Click the floor", "Clear the selection"],
  ["Wheel", "Zoom"],
  ["Drag the floor", "Pan"],
  ["Double-click", "Frame the room again"],
];

/** Every keyboard shortcut, straight from the table that implements them. */
export function ShortcutHelp() {
  const setHelp = useUiStore((state) => state.setHelp);
  return (
    <aside className="help" aria-label="Keyboard shortcuts">
      <header className="panel-header">
        <span>Shortcuts</span>
        <kbd>?</kbd>
        <button className="icon" title="Close (Esc)" aria-label="Close" onClick={() => setHelp(false)}>
          ✕
        </button>
      </header>
      <div className="help-body">
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
          <h3>Mouse</h3>
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
