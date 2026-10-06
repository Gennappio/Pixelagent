import { describe, expect, it } from "vitest";
import {
  HIDEABLE,
  HUD,
  loadPanels,
  PANEL_DEFAULTS,
  parsePanels,
  savePanels,
  setPanel,
  STORAGE_KEY,
  toggleAll,
  togglePanel,
  worldInsets,
} from "./panels";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

describe("panel state", () => {
  it("starts with nothing open but the playback strip", () => {
    expect(PANEL_DEFAULTS).toMatchObject({ office: false, inspector: false, log: false, timeline: false, playback: true, graph: false });
    // A window that is opened shows everything it has: no section starts folded.
    for (const [id, open] of Object.entries(PANEL_DEFAULTS)) if (id.includes(".")) expect(open, id).toBe(true);
  });

  it("toggles one panel without touching the others or the original", () => {
    const next = togglePanel(PANEL_DEFAULTS, "timeline");
    expect(next).toEqual({ ...PANEL_DEFAULTS, timeline: true });
    expect(PANEL_DEFAULTS.timeline).toBe(false);
    expect(togglePanel(next, "timeline")).toEqual(PANEL_DEFAULTS);
  });

  it("keeps the same object when setting a panel to the state it already has", () => {
    expect(setPanel(PANEL_DEFAULTS, "office", false)).toBe(PANEL_DEFAULTS);
    expect(setPanel(PANEL_DEFAULTS, "office", true).office).toBe(true);
  });
});

describe("hide all", () => {
  const custom = { ...PANEL_DEFAULTS, office: true, inspector: true, timeline: true, graph: true, "office.runs": false };

  it("collapses every panel and remembers what was open", () => {
    const hidden = toggleAll(custom, null);
    for (const id of HIDEABLE) expect(hidden.panels[id]).toBe(false);
    expect(hidden.stash).toBe(custom);
  });

  it("leaves the graph and the collapsed sections alone", () => {
    const hidden = toggleAll(custom, null);
    expect(hidden.panels.graph).toBe(true);
    expect(hidden.panels["office.runs"]).toBe(false);
  });

  it("brings back exactly what was open", () => {
    const hidden = toggleAll(custom, null);
    const restored = toggleAll(hidden.panels, hidden.stash);
    expect(restored.panels).toEqual(custom);
    expect(restored.stash).toBeNull();
  });

  it("falls back to the defaults when everything is closed and nothing was remembered", () => {
    const closed = toggleAll(PANEL_DEFAULTS, null).panels;
    expect(toggleAll(closed, null).panels).toEqual(PANEL_DEFAULTS);
  });
});

describe("persistence", () => {
  it("round-trips through storage", () => {
    const storage = memoryStorage();
    const panels = { ...PANEL_DEFAULTS, office: true, timeline: true, "office.tools": false };
    savePanels(storage, panels);
    expect(storage.data.has(STORAGE_KEY)).toBe(true);
    expect(loadPanels(storage)).toEqual(panels);
  });

  it("uses the defaults when nothing is stored or there is no storage", () => {
    expect(loadPanels(memoryStorage())).toEqual(PANEL_DEFAULTS);
    expect(loadPanels(null)).toEqual(PANEL_DEFAULTS);
    expect(() => savePanels(null, PANEL_DEFAULTS)).not.toThrow();
  });

  it("ignores garbage, wrong types and unknown panels", () => {
    expect(parsePanels("{ not json")).toEqual(PANEL_DEFAULTS);
    expect(parsePanels("[1, 2]")).toEqual(PANEL_DEFAULTS);
    expect(parsePanels('"office"')).toEqual(PANEL_DEFAULTS);
    expect(parsePanels(JSON.stringify({ office: "yes", timeline: true, minimap: true }))).toEqual({
      ...PANEL_DEFAULTS,
      timeline: true,
    });
  });

  it("fills in panels added after the state was stored", () => {
    expect(parsePanels(JSON.stringify({ office: true }))).toEqual({ ...PANEL_DEFAULTS, office: true });
  });

  it("survives storage that throws", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("quota");
      },
    };
    expect(loadPanels(broken)).toEqual(PANEL_DEFAULTS);
    expect(() => savePanels(broken, PANEL_DEFAULTS)).not.toThrow();
  });
});

describe("worldInsets", () => {
  it("reserves the edges the open side panels cover", () => {
    expect(worldInsets({ office: true, inspector: true })).toEqual({
      left: HUD.officeWidth + 2 * HUD.gap,
      right: HUD.inspectorWidth + 2 * HUD.gap,
      top: 0,
      bottom: 0,
    });
    expect(worldInsets({ office: false, inspector: false })).toEqual({ left: 0, right: 0, top: 0, bottom: 0 });
  });
});
