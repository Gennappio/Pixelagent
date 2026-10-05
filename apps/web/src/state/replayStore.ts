import { useSyncExternalStore } from "react";
import { ReplayController, type ReplaySnapshot } from "../debugger/ReplayController";

/** The single visualization pipeline shared by live runs and replays. */
export const replay = new ReplayController();

export function useReplay(): ReplaySnapshot {
  return useSyncExternalStore(replay.subscribe, replay.getSnapshot);
}

/** Moves the playhead to just after the n-th event (0 = before the first). */
export function seekToPosition(position: number): void {
  const count = Math.min(position, replay.log.length);
  replay.seek(count <= 0 ? 0 : replay.log[count - 1].sequence);
}
