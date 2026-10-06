import { create } from "zustand";
import type { CameraView } from "../world/Camera";

// The camera belongs to the pixel world, which is not React. This is the little the rest
// of the interface needs of it: what zoom it rests at, to show it, and a way to ask it to
// zoom or to frame the room again. Interface state, like the selection: it is not derived
// from events and never reaches them.

/** What the world's camera can be asked to do from outside the world. */
export interface CameraControls {
  /** One zoom step in (1) or out (-1), around the middle of the free space. */
  zoomBy: (direction: 1 | -1) => void;
  /** Frame the room again. */
  fit: () => void;
}

interface CameraState {
  view: CameraView;
  /** The camera on screen, while there is one. */
  controls: CameraControls | null;
  attach: (controls: CameraControls) => void;
  /** Lets go of `controls`, unless another world has taken over since. */
  detach: (controls: CameraControls) => void;
  report: (view: CameraView) => void;
}

export const useCameraStore = create<CameraState>((set) => ({
  view: { scale: 1, fitted: true },
  controls: null,
  attach: (controls) => set({ controls }),
  detach: (controls) => set((state) => (state.controls === controls ? { controls: null } : state)),
  report: (view) => set({ view }),
}));

/** Zooms the camera on screen one step in or out. Does nothing while there is no world. */
export function zoomCamera(direction: 1 | -1): void {
  useCameraStore.getState().controls?.zoomBy(direction);
}

/** Has the camera on screen frame the room again. */
export function fitCamera(): void {
  useCameraStore.getState().controls?.fit();
}
