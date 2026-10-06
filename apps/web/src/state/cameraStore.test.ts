import { beforeEach, describe, expect, it } from "vitest";
import { fitCamera, useCameraStore, zoomCamera, type CameraControls } from "./cameraStore";

function controls(log: string[], name: string): CameraControls {
  return { zoomBy: (direction) => log.push(`${name} zoom ${direction}`), fit: () => log.push(`${name} fit`) };
}

describe("the camera as the interface knows it", () => {
  beforeEach(() => useCameraStore.setState({ view: { scale: 1, fitted: true }, controls: null }));

  it("does nothing while there is no world on screen", () => {
    expect(() => {
      zoomCamera(1);
      fitCamera();
    }).not.toThrow();
  });

  it("passes zooming and framing on to the camera on screen", () => {
    const log: string[] = [];
    useCameraStore.getState().attach(controls(log, "world"));
    zoomCamera(1);
    zoomCamera(-1);
    fitCamera();
    expect(log).toEqual(["world zoom 1", "world zoom -1", "world fit"]);
  });

  it("keeps the newer world when an older one lets go late", () => {
    const log: string[] = [];
    const first = controls(log, "first");
    const second = controls(log, "second");
    useCameraStore.getState().attach(first);
    useCameraStore.getState().attach(second);
    useCameraStore.getState().detach(first);
    zoomCamera(1);
    expect(log).toEqual(["second zoom 1"]);
    useCameraStore.getState().detach(second);
    zoomCamera(1);
    expect(log).toEqual(["second zoom 1"]);
  });

  it("shows what the camera reports", () => {
    expect(useCameraStore.getState().view).toEqual({ scale: 1, fitted: true });
    useCameraStore.getState().report({ scale: 3, fitted: false });
    expect(useCameraStore.getState().view).toEqual({ scale: 3, fitted: false });
  });
});
