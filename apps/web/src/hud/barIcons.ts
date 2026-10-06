import type { IconName } from "../pixel/bitmaps";
import type { PanelState } from "./panels";
import { SHORTCUTS, type ShortcutAction } from "./shortcuts";

// The icon bar: one icon per window, lit while that window is open, with its key under it.
// Data, like the shortcuts it is read from: an icon does exactly what its key does, so the
// two cannot drift apart.

export type BarWindow = "office" | "inspector" | "log" | "timeline" | "graph" | "help";

export interface BarIcon {
  window: BarWindow;
  icon: IconName;
  /** What the window is called, for whoever hovers the icon. */
  title: string;
  /** The key that does the same, as it is printed under the icon. */
  key: string;
  /** What the window is for, from the shortcut table. */
  description: string;
  action: ShortcutAction;
}

const WINDOWS: { window: BarWindow; title: string }[] = [
  { window: "office", title: "Office" },
  { window: "inspector", title: "Inspector" },
  { window: "log", title: "Log" },
  { window: "timeline", title: "Timeline" },
  { window: "graph", title: "Graph" },
  { window: "help", title: "Shortcuts" },
];

function actionOf(window: BarWindow): ShortcutAction {
  return window === "help" ? { type: "help" } : { type: "togglePanel", panel: window };
}

function sameAction(a: ShortcutAction, b: ShortcutAction): boolean {
  return a.type === b.type && (a.type !== "togglePanel" || a.panel === (b as typeof a).panel);
}

export const ICON_BAR: BarIcon[] = WINDOWS.map(({ window, title }) => {
  const action = actionOf(window);
  const shortcut = SHORTCUTS.find((candidate) => sameAction(candidate.action, action));
  if (!shortcut) throw new Error(`the ${window} window has an icon and no key`);
  return { window, icon: window, title, key: shortcut.label, description: shortcut.description, action };
});

/**
 * Whether a window has anything to show. The log is the transcript of a run: with none on
 * screen neither its icon nor its key opens it, and nothing is toggled behind the scenes.
 */
export function canOpen(window: BarWindow, hasRun: boolean): boolean {
  return window !== "log" || hasRun;
}

/** Whether the window an icon stands for is open: what lights the icon. */
export function isLit(window: BarWindow, panels: Pick<PanelState, "office" | "inspector" | "log" | "timeline" | "graph">, help: boolean): boolean {
  return window === "help" ? help : panels[window];
}
