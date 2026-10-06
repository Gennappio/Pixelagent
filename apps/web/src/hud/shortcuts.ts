import type { PanelId } from "./panels";

// Keyboard shortcuts as data plus one pure lookup. The help popover lists this same table,
// so a shortcut cannot exist without being documented, or be documented without existing.

export type ShortcutAction =
  | { type: "togglePanel"; panel: PanelId }
  | { type: "toggleAll" }
  | { type: "help" }
  | { type: "escape" }
  | { type: "playPause" }
  | { type: "next" }
  | { type: "previous" }
  | { type: "toStart" }
  | { type: "toEnd" }
  | { type: "faster" }
  | { type: "slower" }
  | { type: "zoomIn" }
  | { type: "zoomOut" }
  | { type: "run" }
  | { type: "save" };

export type ShortcutGroup = "Panels" | "Playback" | "Camera" | "Workflow";

export interface Shortcut {
  group: ShortcutGroup;
  /** `KeyboardEvent.key` values; single characters are matched case-insensitively. */
  keys: string[];
  /** Needs Ctrl (or ⌘ on a Mac). Such shortcuts also work while typing in a field. */
  mod?: boolean;
  /** Fires again while the key is held down. */
  repeat?: boolean;
  label: string;
  description: string;
  action: ShortcutAction;
}

const panel = (id: PanelId): ShortcutAction => ({ type: "togglePanel", panel: id });

export const SHORTCUTS: Shortcut[] = [
  { group: "Panels", keys: ["o"], label: "O", description: "Office: workflow, agents, tools, runs", action: panel("office") },
  { group: "Panels", keys: ["i"], label: "I", description: "Inspector", action: panel("inspector") },
  { group: "Panels", keys: ["l"], label: "L", description: "Log of the run on screen", action: panel("log") },
  { group: "Panels", keys: ["t"], label: "T", description: "Timeline", action: panel("timeline") },
  { group: "Panels", keys: ["b"], label: "B", description: "Playback bar", action: panel("playback") },
  { group: "Panels", keys: ["g"], label: "G", description: "Graph of the workflow", action: panel("graph") },
  { group: "Panels", keys: ["h"], label: "H", description: "Hide or bring back every panel", action: { type: "toggleAll" } },
  { group: "Panels", keys: ["Escape"], label: "Esc", description: "Close the graph, or clear the selection", action: { type: "escape" } },
  { group: "Panels", keys: ["?"], label: "?", description: "This list", action: { type: "help" } },

  { group: "Playback", keys: [" "], label: "Space", description: "Play or pause", action: { type: "playPause" } },
  { group: "Playback", keys: ["ArrowRight"], repeat: true, label: "→", description: "Next event", action: { type: "next" } },
  { group: "Playback", keys: ["ArrowLeft"], repeat: true, label: "←", description: "Previous event", action: { type: "previous" } },
  { group: "Playback", keys: ["Home"], label: "Home", description: "Back to the start", action: { type: "toStart" } },
  { group: "Playback", keys: ["End"], label: "End", description: "Jump to the end", action: { type: "toEnd" } },
  { group: "Playback", keys: ["."], label: ".", description: "Faster", action: { type: "faster" } },
  { group: "Playback", keys: [","], label: ",", description: "Slower", action: { type: "slower" } },

  // "=" is the unshifted + of a US keyboard. With Ctrl or ⌘ these are the browser's own zoom, and are left to it.
  { group: "Camera", keys: ["+", "="], repeat: true, label: "+", description: "Zoom in one step", action: { type: "zoomIn" } },
  { group: "Camera", keys: ["-"], repeat: true, label: "−", description: "Zoom out one step", action: { type: "zoomOut" } },

  { group: "Workflow", keys: ["Enter"], mod: true, label: "Ctrl Enter", description: "Run the workflow", action: { type: "run" } },
  { group: "Workflow", keys: ["s"], mod: true, label: "Ctrl S", description: "Save the workflow", action: { type: "save" } },
];

/** Where the key was pressed. Typing into a field must never trigger a plain shortcut. */
export type KeyTarget = "editable" | "button" | "other";

export interface KeyInput {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  /** The key is being held down. */
  repeat?: boolean;
  target: KeyTarget;
}

/** The action a key press stands for, or null when it should be left to the browser. */
export function shortcutFor(input: KeyInput): ShortcutAction | null {
  if (input.altKey) return null;
  const key = input.key.length === 1 ? input.key.toLowerCase() : input.key;
  const mod = Boolean(input.ctrlKey || input.metaKey);
  const match = SHORTCUTS.find((shortcut) => Boolean(shortcut.mod) === mod && shortcut.keys.includes(key));
  if (!match) return null;
  if (input.repeat && !match.repeat) return null;
  if (!match.mod) {
    if (input.target === "editable") return null;
    // Space on a focused button presses that button; do not also act on it globally.
    if (input.target === "button" && key === " ") return null;
  }
  return match.action;
}
