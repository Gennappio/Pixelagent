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
});
