import { describe, expect, it } from "vitest";
import { ICONS, sizeOf } from "../pixel/bitmaps";
import { canOpen, ICON_BAR, isLit, type BarWindow } from "./barIcons";
import { PANEL_DEFAULTS, togglePanel } from "./panels";
import { shortcutFor, SHORTCUTS } from "./shortcuts";

describe("the icon bar", () => {
  it("has one icon per window, in the order of the keys printed under them", () => {
    expect(ICON_BAR.map((entry) => entry.window)).toEqual(["office", "inspector", "log", "timeline", "graph", "help"]);
    expect(ICON_BAR.map((entry) => entry.key)).toEqual(["O", "I", "L", "T", "G", "?"]);
  });

  it("gives every window a picture of its own, at the size of the bar", () => {
    for (const entry of ICON_BAR) expect(sizeOf(ICONS[entry.icon]), entry.window).toEqual({ width: 12, height: 12 });
    expect(new Set(ICON_BAR.map((entry) => entry.icon)).size).toBe(ICON_BAR.length);
  });

  it("does with a click exactly what the key under the icon does", () => {
    for (const entry of ICON_BAR) {
      const shortcut = SHORTCUTS.find((candidate) => candidate.label === entry.key);
      expect(shortcut, entry.window).toBeDefined();
      expect(entry.action, entry.window).toEqual(shortcut!.action);
      expect(entry.description, entry.window).toBe(shortcut!.description);
      // And pressing that key finds the same action.
      expect(shortcutFor({ key: shortcut!.keys[0], target: "other" }), entry.window).toEqual(entry.action);
    }
  });

  it("opens the window it is named after", () => {
    for (const entry of ICON_BAR) {
      expect(entry.action).toEqual(entry.window === "help" ? { type: "help" } : { type: "togglePanel", panel: entry.window });
    }
  });
});

describe("canOpen", () => {
  it("keeps the log shut while there is no run to read, and nothing else", () => {
    for (const { window } of ICON_BAR) {
      expect(canOpen(window, true), window).toBe(true);
      expect(canOpen(window, false), window).toBe(window !== "log");
    }
  });
});

describe("isLit", () => {
  const windows = ICON_BAR.map((entry) => entry.window);

  it("lights nothing when the interface opens", () => {
    for (const window of windows) expect(isLit(window, PANEL_DEFAULTS, false), window).toBe(false);
  });

  it("lights the icon of each open window and no other", () => {
    for (const open of windows.filter((window): window is Exclude<BarWindow, "help"> => window !== "help")) {
      const panels = togglePanel(PANEL_DEFAULTS, open);
      for (const window of windows) expect(isLit(window, panels, false), `${window} with ${open} open`).toBe(window === open);
    }
  });

  it("lights the help icon while the shortcut list is showing, whatever else is open", () => {
    expect(isLit("help", PANEL_DEFAULTS, true)).toBe(true);
    expect(isLit("help", togglePanel(PANEL_DEFAULTS, "office"), false)).toBe(false);
    expect(isLit("office", PANEL_DEFAULTS, true)).toBe(false);
  });
});
