import { describe, expect, it } from "vitest";
import { PANEL_DEFAULTS } from "./panels";
import { shortcutFor, SHORTCUTS, type KeyInput } from "./shortcuts";

const press = (key: string, extra: Partial<KeyInput> = {}) => shortcutFor({ key, target: "other", ...extra });

describe("shortcutFor", () => {
  it("maps panel keys to their panel, whatever the case", () => {
    expect(press("o")).toEqual({ type: "togglePanel", panel: "office" });
    expect(press("I")).toEqual({ type: "togglePanel", panel: "inspector" });
    expect(press("l")).toEqual({ type: "togglePanel", panel: "log" });
    expect(press("t")).toEqual({ type: "togglePanel", panel: "timeline" });
    expect(press("b")).toEqual({ type: "togglePanel", panel: "playback" });
    expect(press("g")).toEqual({ type: "togglePanel", panel: "graph" });
    expect(press("h")).toEqual({ type: "toggleAll" });
  });

  it("maps the playback keys", () => {
    expect(press(" ")).toEqual({ type: "playPause" });
    expect(press("ArrowRight")).toEqual({ type: "next" });
    expect(press("ArrowLeft")).toEqual({ type: "previous" });
    expect(press("Home")).toEqual({ type: "toStart" });
    expect(press("End")).toEqual({ type: "toEnd" });
    expect(press(".")).toEqual({ type: "faster" });
    expect(press(",")).toEqual({ type: "slower" });
  });

  it("maps − and + to the camera, not to the speed of the replay any more", () => {
    expect(press("+")).toEqual({ type: "zoomIn" });
    expect(press("=")).toEqual({ type: "zoomIn" }); // the unshifted + on a US keyboard
    expect(press("-")).toEqual({ type: "zoomOut" });
    // Held down, they keep going.
    expect(press("+", { repeat: true })).toEqual({ type: "zoomIn" });
    expect(press("-", { repeat: true })).toEqual({ type: "zoomOut" });
    // With Ctrl or ⌘ they are the browser's own zoom, and are left to it.
    for (const key of ["+", "=", "-"]) {
      expect(press(key, { ctrlKey: true })).toBeNull();
      expect(press(key, { metaKey: true })).toBeNull();
    }
    expect(press("+", { target: "editable" })).toBeNull();
  });

  it("never fires a plain shortcut while the user is typing", () => {
    for (const shortcut of SHORTCUTS.filter((candidate) => !candidate.mod && !candidate.whileTyping)) {
      expect(press(shortcut.keys[0], { target: "editable" })).toBeNull();
    }
  });

  it("lets Esc through from a field: it types nothing, and gets out of whatever is open", () => {
    expect(press("Escape", { target: "editable" })).toEqual({ type: "escape" });
    expect(press("Escape")).toEqual({ type: "escape" });
    // It is the only one.
    expect(SHORTCUTS.filter((shortcut) => shortcut.whileTyping).map((shortcut) => shortcut.keys)).toEqual([["Escape"]]);
  });

  it("lets Ctrl or ⌘ shortcuts through even from a text field", () => {
    expect(press("s", { ctrlKey: true, target: "editable" })).toEqual({ type: "save" });
    expect(press("S", { metaKey: true })).toEqual({ type: "save" });
    expect(press("Enter", { metaKey: true, target: "editable" })).toEqual({ type: "run" });
  });

  it("leaves browser combinations alone", () => {
    expect(press("o", { ctrlKey: true })).toBeNull(); // open file
    expect(press("t", { metaKey: true })).toBeNull(); // new tab
    expect(press("ArrowLeft", { altKey: true })).toBeNull(); // history back
    expect(press("s")).toBeNull(); // plain S is not a shortcut
    expect(press("Enter")).toBeNull();
  });

  it("leaves Space to a focused button, but still handles other keys there", () => {
    expect(press(" ", { target: "button" })).toBeNull();
    expect(press("ArrowRight", { target: "button" })).toEqual({ type: "next" });
    expect(press("g", { target: "button" })).toEqual({ type: "togglePanel", panel: "graph" });
  });

  it("repeats only the stepping and zooming keys while a key is held", () => {
    expect(press("ArrowRight", { repeat: true })).toEqual({ type: "next" });
    expect(press("ArrowLeft", { repeat: true })).toEqual({ type: "previous" });
    expect(press("g", { repeat: true })).toBeNull();
    expect(press(" ", { repeat: true })).toBeNull();
    expect(press(".", { repeat: true })).toBeNull();
    expect(SHORTCUTS.filter((shortcut) => shortcut.repeat).map((shortcut) => shortcut.action.type)).toEqual(["next", "previous", "zoomIn", "zoomOut"]);
  });
});

describe("the shortcut table", () => {
  it("has no two shortcuts on the same key", () => {
    const seen = new Set<string>();
    for (const shortcut of SHORTCUTS) {
      for (const key of shortcut.keys) {
        const id = `${shortcut.mod ? "mod+" : ""}${key}`;
        expect(seen.has(id), `duplicate shortcut ${id}`).toBe(false);
        seen.add(id);
      }
    }
  });

  it("resolves every listed key to its own action, so the help never lies", () => {
    for (const shortcut of SHORTCUTS) {
      for (const key of shortcut.keys) {
        expect(press(key, { ctrlKey: shortcut.mod })).toEqual(shortcut.action);
      }
    }
  });

  it("only toggles panels that exist", () => {
    for (const { action } of SHORTCUTS) {
      if (action.type === "togglePanel") expect(action.panel in PANEL_DEFAULTS).toBe(true);
    }
  });
});
