import { describe, expect, it } from "vitest";
import { PANEL_DEFAULTS, parsePanels, STORAGE_KEY } from "../hud/panels";
import { createUiStore } from "./uiStore";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    stored: () => parsePanels(data.get(STORAGE_KEY)),
  };
}

describe("ui store", () => {
  it("restores the panels the user left open", () => {
    const storage = memoryStorage({ [STORAGE_KEY]: JSON.stringify({ office: false, timeline: true }) });
    expect(createUiStore(storage).getState().panels).toEqual({ ...PANEL_DEFAULTS, office: false, timeline: true });
  });

  it("works without any storage", () => {
    const store = createUiStore(null);
    store.getState().toggle("timeline");
    expect(store.getState().panels.timeline).toBe(true);
  });

  it("remembers every change", () => {
    const storage = memoryStorage();
    const store = createUiStore(storage);
    store.getState().toggle("graph");
    expect(storage.stored().graph).toBe(true);
    store.getState().setPanel("office", false);
    expect(storage.stored().office).toBe(false);
    store.getState().toggleAll();
    expect(storage.stored()).toMatchObject({ office: false, log: false, playback: false });
  });

  it("opens the inspector when something is selected", () => {
    const storage = memoryStorage();
    const store = createUiStore(storage);
    expect(store.getState().panels.inspector).toBe(false);

    store.getState().select({ kind: "agent", agentId: "luca" });
    expect(store.getState().selection).toEqual({ kind: "agent", agentId: "luca" });
    expect(store.getState().panels.inspector).toBe(true);
    expect(storage.stored().inspector).toBe(true);
  });

  it("does not reopen the inspector when the selection is cleared", () => {
    const store = createUiStore(null);
    store.getState().select({ kind: "tool", tool: "web_search" });
    store.getState().toggle("inspector");
    store.getState().select(null);
    expect(store.getState().panels.inspector).toBe(false);
    expect(store.getState().selection).toBeNull();
  });

  it("hide all then hide all again returns to the same panels", () => {
    const store = createUiStore(null);
    store.getState().toggle("timeline");
    const before = store.getState().panels;
    store.getState().toggleAll();
    expect(store.getState().panels.office).toBe(false);
    store.getState().toggleAll();
    expect(store.getState().panels).toEqual(before);
  });

  it("opens the build menu on a thing without opening the inspector, and marks the thing as selected", () => {
    const store = createUiStore(null);
    store.getState().openMenu({ kind: "agent", agentId: "luca" });
    expect(store.getState().menu).toEqual({ kind: "agent", agentId: "luca" });
    expect(store.getState().selection).toEqual({ kind: "agent", agentId: "luca" });
    expect(store.getState().panels.inspector).toBe(false);
    store.getState().openMenu({ kind: "station", tool: "web_search" });
    expect(store.getState().selection).toEqual({ kind: "tool", tool: "web_search" });
    store.getState().openMenu({ kind: "table", tableId: "board" });
    expect(store.getState().selection).toEqual({ kind: "table", tableId: "board" });
    // A spot on the floor is nothing to select.
    store.getState().openMenu({ kind: "floor", at: { x: 10, y: 200 } });
    expect(store.getState().selection).toBeNull();
    expect(store.getState().panels.inspector).toBe(false);
  });

  it("keeps the menu behind a sentence that waits for its object, and shows it again afterwards", () => {
    const store = createUiStore(null);
    store.getState().openMenu({ kind: "agent", agentId: "anna" });
    store.getState().startPicking({ subject: "anna", verb: "sends_to" });
    expect(store.getState().pending).toEqual({ subject: "anna", verb: "sends_to" });
    expect(store.getState().menu).toEqual({ kind: "agent", agentId: "anna" });
    // Picked or given up, it ends the same way for the interface: back to the menu it was started from.
    store.getState().stopPicking();
    expect(store.getState().pending).toBeNull();
    expect(store.getState().menu).toEqual({ kind: "agent", agentId: "anna" });
    expect(store.getState().selection).toEqual({ kind: "agent", agentId: "anna" });
  });

  it("drops a pending sentence when the menu is closed, or another is opened", () => {
    const store = createUiStore(null);
    store.getState().openMenu({ kind: "agent", agentId: "anna" });
    store.getState().startPicking({ subject: "anna", verb: "sends_to" });
    store.getState().closeMenu();
    expect([store.getState().menu, store.getState().pending]).toEqual([null, null]);

    store.getState().openMenu({ kind: "agent", agentId: "anna" });
    store.getState().startPicking({ subject: "anna", verb: "uses_tool", required: true });
    store.getState().openMenu({ kind: "agent", agentId: "luca" });
    expect(store.getState().pending).toBeNull();
    expect(store.getState().menu).toEqual({ kind: "agent", agentId: "luca" });
  });

  it("changes nothing when there is nothing to close or to give up", () => {
    const store = createUiStore(null);
    const before = store.getState();
    store.getState().closeMenu();
    store.getState().stopPicking();
    expect(store.getState()).toBe(before);
  });
});
