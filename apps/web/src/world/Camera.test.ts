import { describe, expect, it } from "vitest";
import { fitView, NO_INSETS } from "./Camera";

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
