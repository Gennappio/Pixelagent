import { fitCamera, useCameraStore, zoomCamera } from "../state/cameraStore";
import { adjacentStep, zoomLabel } from "../world/Camera";
import { PixelIcon } from "./PixelIcon";

/**
 * The two buttons that make it obvious the world zooms, with the step it is at between
 * them. The step is itself a button: it frames the room again.
 */
export function ZoomControl() {
  const { scale, fitted } = useCameraStore((state) => state.view);
  return (
    <span className="zoom" role="group" aria-label="Zoom">
      <button title="Zoom out (−)" aria-label="Zoom out" disabled={adjacentStep(scale, -1) === scale} onClick={() => zoomCamera(-1)}>
        <PixelIcon name="minus" />
      </button>
      <button
        className={`zoom-level${fitted ? " fitted" : ""}`}
        title={fitted ? "The room is framed. Zoom with − +, pinch, or Ctrl + wheel" : "Frame the room again (or double-click the floor)"}
        aria-label={`Zoom ${zoomLabel(scale)}${fitted ? ", the room is framed" : ": frame the room again"}`}
        onClick={fitCamera}
      >
        {zoomLabel(scale)}
      </button>
      <button title="Zoom in (+)" aria-label="Zoom in" disabled={adjacentStep(scale, 1) === scale} onClick={() => zoomCamera(1)}>
        <PixelIcon name="plus" />
      </button>
    </span>
  );
}
