import { create } from "zustand";
import type { PendingSentence } from "../build/picking";
import {
  loadPanels,
  savePanels,
  setPanel,
  toggleAll,
  togglePanel,
  type PanelId,
  type PanelState,
} from "../hud/panels";

export type Selection =
  | { kind: "agent"; agentId: string }
  | { kind: "event"; eventId: string }
  | { kind: "tool"; tool: string }
  | { kind: "document"; documentId: string }
  | { kind: "table"; tableId: string }
  | null;

/**
 * What the build menu is open on: a character, a table, a tool's station, or a spot on the
 * floor (world coordinates) where something could be added.
 */
export type MenuTarget =
  | { kind: "agent"; agentId: string }
  | { kind: "table"; tableId: string }
  | { kind: "station"; tool: string }
  | { kind: "floor"; at: { x: number; y: number } };

function selectionOf(target: MenuTarget): Selection {
  if (target.kind === "agent") return { kind: "agent", agentId: target.agentId };
  if (target.kind === "table") return { kind: "table", tableId: target.tableId };
  if (target.kind === "station") return { kind: "tool", tool: target.tool };
  return null;
}

type PanelStorage = Parameters<typeof savePanels>[0];

interface UiState {
  /** Which parts of the HUD are open. Remembered across reloads. */
  panels: PanelState;
  /** What "hide all" will bring back. */
  stash: PanelState | null;
  /** The keyboard shortcut list is showing. */
  help: boolean;
  selection: Selection;
  /** Build mode: the menu open on something in the office, where it stands. */
  menu: MenuTarget | null;
  /**
   * Build mode: a sentence that has its subject and verb and waits for its object to be
   * picked in the office. While it is pending a click means "this one", not "select", and
   * the menu it was started from is folded away.
   */
  pending: PendingSentence | null;

  /** Selecting something opens the inspector: that is what selecting is for. */
  select: (selection: Selection) => void;
  /**
   * Opens the build menu on something, and marks it as selected. It does not open the
   * inspector: in build mode what a thing does is said on the thing itself.
   */
  openMenu: (target: MenuTarget) => void;
  /** Closes the build menu, and drops a sentence that was waiting for its object. */
  closeMenu: () => void;
  startPicking: (pending: PendingSentence) => void;
  /** Drops the pending sentence, picked or not: the menu it was started from shows again. */
  stopPicking: () => void;
  toggle: (panel: PanelId) => void;
  setPanel: (panel: PanelId, open: boolean) => void;
  toggleAll: () => void;
  setHelp: (help: boolean) => void;
}

function browserStorage(): PanelStorage {
  try {
    const storage = globalThis.localStorage;
    return storage && typeof storage.getItem === "function" ? storage : null;
  } catch {
    return null; // storage can be blocked outright
  }
}

export function createUiStore(storage: PanelStorage) {
  const remember = (panels: PanelState): PanelState => {
    savePanels(storage, panels);
    return panels;
  };

  return create<UiState>((set) => ({
    panels: loadPanels(storage),
    stash: null,
    help: false,
    selection: null,
    menu: null,
    pending: null,

    select: (selection) =>
      set((state) => ({
        selection,
        panels: selection && !state.panels.inspector ? remember(setPanel(state.panels, "inspector", true)) : state.panels,
      })),
    openMenu: (target) => set({ menu: target, pending: null, selection: selectionOf(target) }),
    closeMenu: () => set((state) => (state.menu || state.pending ? { menu: null, pending: null } : state)),
    startPicking: (pending) => set({ pending }),
    stopPicking: () => set((state) => (state.pending ? { pending: null } : state)),
    toggle: (panel) => set((state) => ({ panels: remember(togglePanel(state.panels, panel)) })),
    setPanel: (panel, open) =>
      set((state) => (state.panels[panel] === open ? state : { panels: remember(setPanel(state.panels, panel, open)) })),
    toggleAll: () =>
      set((state) => {
        const next = toggleAll(state.panels, state.stash);
        return { panels: remember(next.panels), stash: next.stash };
      }),
    setHelp: (help) => set({ help }),
  }));
}

export const useUiStore = createUiStore(browserStorage());
