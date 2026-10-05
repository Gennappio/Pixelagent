import { create } from "zustand";

export type Selection =
  | { kind: "agent"; agentId: string }
  | { kind: "event"; eventId: string }
  | { kind: "tool"; tool: string }
  | null;

interface UiState {
  view: "graph" | "world";
  selection: Selection;
  setView: (view: UiState["view"]) => void;
  select: (selection: Selection) => void;
}

export const useUiStore = create<UiState>((set) => ({
  view: "graph",
  selection: null,
  setView: (view) => set({ view }),
  select: (selection) => set({ selection }),
}));
