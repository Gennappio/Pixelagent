import { useSyncExternalStore } from "react";
import { ReplayController, type ReplaySnapshot } from "../debugger/ReplayController";

/** The single visualization pipeline shared by live runs and replays. */
export const replay = new ReplayController();

export function useReplay(): ReplaySnapshot {
  return useSyncExternalStore(replay.subscribe, replay.getSnapshot);
}
