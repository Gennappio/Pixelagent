import { describe, expect, it } from "vitest";
import { fitView, focusView, NO_INSETS } from "./Camera";

const room = { width: 640, height: 400 };

/** The offset is snapped to whole pixels to keep the art crisp, so margins may differ by one. */
const PIXEL = 1;

/** The rectangle the room occupies on screen for a given framing. */
function onScreen(framing: ReturnType<typeof fitView>) {
  return {
    left: framing.x,
    right: framing.x + room.width * framing.scale,
    top: framing.y,
    bottom: framing.y + room.height * framing.scale,
  };
}

describe("fitView", () => {
  it("centres the room in an unobstructed viewport, keeping its proportions", () => {
    const view = { width: 1280, height: 800 };
    const box = onScreen(fitView(view, room, NO_INSETS));
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(view.width);
    expect(box.top).toBeGreaterThanOrEqual(0);
    expect(box.bottom).toBeLessThanOrEqual(view.height);
    expect(Math.abs(box.left - (view.width - box.right))).toBeLessThanOrEqual(PIXEL);
    expect(Math.abs(box.top - (view.height - box.bottom))).toBeLessThanOrEqual(PIXEL);
    expect(Number.isInteger(box.left) && Number.isInteger(box.top)).toBe(true);
  });

  it("is limited by whichever dimension is tighter", () => {
    expect(fitView({ width: 2000, height: 400 }, room).scale).toBeCloseTo(0.96);
    expect(fitView({ width: 640, height: 2000 }, room).scale).toBeCloseTo(0.96);
  });

  it("frames the room beside the panels, never under them", () => {
    const view = { width: 1440, height: 800 };
    const insets = { left: 266, right: 356, top: 0, bottom: 0 };
    const box = onScreen(fitView(view, room, insets));
    expect(box.left).toBeGreaterThanOrEqual(insets.left);
    expect(box.right).toBeLessThanOrEqual(view.width - insets.right);
    // centred in the free area, not in the viewport
    expect(Math.abs(box.left - insets.left - (view.width - insets.right - box.right))).toBeLessThanOrEqual(PIXEL);
  });

  it("shrinks the room when a panel opens and gives the space back when it closes", () => {
    const view = { width: 1000, height: 800 };
    const open = fitView(view, room, { left: 266, right: 0, top: 0, bottom: 0 });
    const closed = fitView(view, room, NO_INSETS);
    expect(open.scale).toBeLessThan(closed.scale);
    expect(open.x).toBeGreaterThan(closed.x);
  });

  it("ignores the panels when they leave no usable space", () => {
    const view = { width: 500, height: 600 };
    const cramped = { left: 266, right: 356, top: 0, bottom: 0 };
    expect(fitView(view, room, cramped)).toEqual(fitView(view, room, NO_INSETS));
  });

  it("never returns a zero or negative scale", () => {
    expect(fitView({ width: 0, height: 0 }, room).scale).toBeGreaterThan(0);
  });
});

describe("focusView", () => {
  const view = { width: 1000, height: 600 };
  // Zoomed in three times on the top-left corner of the room.
  const zoomed = { scale: 3, x: 0, y: 0 };
  const onScreen = (framing: { scale: number; x: number; y: number }, point: { x: number; y: number }) => ({
    x: framing.x + point.x * framing.scale,
    y: framing.y + point.y * framing.scale,
  });

  it("leaves the camera alone when the point is comfortably in view", () => {
    expect(focusView(view, NO_INSETS, zoomed, { x: 150, y: 100 })).toBeNull();
    expect(focusView(view, NO_INSETS, fitView(view, room), { x: 320, y: 280 })).toBeNull();
  });

  it("brings a point that is out of view to the middle, at the same zoom", () => {
    const point = { x: 470, y: 280 }; // far off to the right and below
    const moved = focusView(view, NO_INSETS, zoomed, point)!;
    expect(moved.scale).toBe(3);
    expect(onScreen(moved, point)).toEqual({ x: 500, y: 300 });
  });

  it("moves for a point that is in view but hard against the edge", () => {
    const atTheEdge = { x: 5, y: 100 }; // 15 px from the left edge of the screen
    expect(onScreen(zoomed, atTheEdge).x).toBe(15);
    expect(focusView(view, NO_INSETS, zoomed, atTheEdge)).not.toBeNull();
  });

  it("counts a point hidden under a panel as out of view, and centres it beside the panels", () => {
    const insets = { left: 266, right: 356, top: 0, bottom: 0 };
    const underThePanel = { x: 60, y: 100 }; // on screen at x = 180, behind the left panel
    expect(focusView(view, NO_INSETS, zoomed, underThePanel)).toBeNull();
    const moved = focusView(view, insets, zoomed, underThePanel)!;
    expect(onScreen(moved, underThePanel).x).toBe((266 + (1000 - 356)) / 2);
  });

  it("settles: the framing it returns needs no further move", () => {
    const point = { x: 470, y: 280 };
    const moved = focusView(view, NO_INSETS, zoomed, point)!;
    expect(focusView(view, NO_INSETS, moved, point)).toBeNull();
  });

  it("ignores panels that leave no usable space, as framing does", () => {
    const narrow = { width: 500, height: 600 };
    const cramped = { left: 266, right: 356, top: 0, bottom: 0 };
    const point = { x: 470, y: 280 };
    expect(focusView(narrow, cramped, zoomed, point)).toEqual(focusView(narrow, NO_INSETS, zoomed, point));
  });
});

