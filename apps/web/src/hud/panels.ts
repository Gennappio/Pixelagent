import type { Insets } from "../world/Camera";

// Which windows are open. Pure, so it is testable without a browser.

/**
 * Every part of the interface that opens and closes, and whether it starts open. Nothing
 * does but the playback strip: the world fills the screen, and a window is opened from
 * its icon on the bar when it is wanted. What a browser has open is remembered.
 */
export const PANEL_DEFAULTS = {
  office: false,
  /** Opens by itself when something is selected. */
  inspector: false,
  log: false,
  timeline: false,
  /** false = collapsed to a thin progress strip. */
  playback: true,
  graph: false,
  "office.workflow": true,
  "office.agents": true,
  "office.tools": true,
  "office.tables": true,
  "office.sheets": true,
  "office.runs": true,
} satisfies Record<string, boolean>;

export type PanelId = keyof typeof PANEL_DEFAULTS;
export type PanelState = Record<PanelId, boolean>;

const PANEL_IDS = Object.keys(PANEL_DEFAULTS) as PanelId[];

/** What "hide all" collapses to leave nothing but the world on screen. */
export const HIDEABLE = ["office", "inspector", "log", "timeline", "playback"] as const satisfies readonly PanelId[];

export function togglePanel(panels: PanelState, id: PanelId): PanelState {
  return { ...panels, [id]: !panels[id] };
}

export function setPanel(panels: PanelState, id: PanelId, open: boolean): PanelState {
  return panels[id] === open ? panels : { ...panels, [id]: open };
}

function pick(source: PanelState, ids: readonly PanelId[]): Partial<PanelState> {
  return Object.fromEntries(ids.map((id) => [id, source[id]]));
}

/**
 * Collapses every panel, or brings back what was open before the last "hide all".
 * `stash` is the state to return to; pass back the one this function gave you.
 */
export function toggleAll(panels: PanelState, stash: PanelState | null): { panels: PanelState; stash: PanelState | null } {
  if (HIDEABLE.some((id) => panels[id])) {
    return { panels: { ...panels, ...Object.fromEntries(HIDEABLE.map((id) => [id, false])) }, stash: panels };
  }
  return { panels: { ...panels, ...pick(stash ?? PANEL_DEFAULTS, HIDEABLE) }, stash: null };
}

// Persistence. The HUD must keep working when storage is missing, full or holds garbage.

export const STORAGE_KEY = "pixelagents.hud.v1";

type PanelStorage = Pick<Storage, "getItem" | "setItem">;

/** Reads a stored panel state, falling back to the default for anything missing or malformed. */
export function parsePanels(raw: string | null | undefined): PanelState {
  let stored: unknown = null;
  try {
    stored = raw ? JSON.parse(raw) : null;
  } catch {
    stored = null;
  }
  const source = stored && typeof stored === "object" ? (stored as Record<string, unknown>) : {};
  const panels: PanelState = { ...PANEL_DEFAULTS };
  for (const id of PANEL_IDS) {
    const value = source[id];
    if (typeof value === "boolean") panels[id] = value;
  }
  return panels;
}

export function loadPanels(storage: PanelStorage | null): PanelState {
  try {
    return parsePanels(storage?.getItem(STORAGE_KEY));
  } catch {
    return { ...PANEL_DEFAULTS };
  }
}

export function savePanels(storage: PanelStorage | null, panels: PanelState): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(panels));
  } catch {
    // Private mode or a full quota: the HUD still works, it just forgets on reload.
  }
}

// Geometry shared by the stylesheet (through CSS variables) and the world camera.

export const HUD = { gap: 8, officeWidth: 256, inspectorWidth: 352 } as const;

/** The viewport edges the open side panels cover, so the camera can frame the room beside them. */
export function worldInsets(panels: Pick<PanelState, "office" | "inspector">): Insets {
  return {
    left: panels.office ? HUD.officeWidth + 2 * HUD.gap : 0,
    right: panels.inspector ? HUD.inspectorWidth + 2 * HUD.gap : 0,
    top: 0,
    bottom: 0,
  };
}
