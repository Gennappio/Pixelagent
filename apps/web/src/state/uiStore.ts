import { create } from "zustand";
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
  | null;

type PanelStorage = Parameters<typeof savePanels>[0];

interface UiState {
  /** Which parts of the HUD are open. Remembered across reloads. */
  panels: PanelState;
  /** What "hide all" will bring back. */
  stash: PanelState | null;
  /** The keyboard shortcut list is showing. */
  help: boolean;
  selection: Selection;

  /** Selecting something opens the inspector: that is what selecting is for. */
  select: (selection: Selection) => void;
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

    select: (selection) =>
      set((state) => ({
        selection,
        panels: selection && !state.panels.inspector ? remember(setPanel(state.panels, "inspector", true)) : state.panels,
      })),
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
