import { describe, expect, it } from "vitest";
import {
  accumulateZoom,
  adjacentStep,
  fitStep,
  fitView,
  focusView,
  keepInView,
  NO_INSETS,
  NO_PENDING_ZOOM,
  pinchTravel,
  wheelPixels,
  zoomAround,
  zoomLabel,
  ZOOM_NOTCH,
  ZOOM_STEPS,
  type Framing,
  type PendingZoom,
} from "./Camera";

const room = { width: 640, height: 400 };

/** The offset is snapped to whole pixels to keep the art crisp, so margins may differ by one. */
const PIXEL = 1;

/** The rectangle the room occupies on screen for a given framing. */
function onScreen(framing: Framing) {
  return {
    left: framing.x,
    right: framing.x + room.width * framing.scale,
    top: framing.y,
    bottom: framing.y + room.height * framing.scale,
  };
}

describe("zoom steps", () => {
  it("are the whole multiples of the base scale from 1 to 8, plus one half for an overview", () => {
    expect(ZOOM_STEPS).toEqual([0.5, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(ZOOM_STEPS.filter((step) => !Number.isInteger(step))).toEqual([0.5]);
  });

  it("go one at a time, and stop at either end", () => {
    const up = ZOOM_STEPS.map((step) => adjacentStep(step, 1));
    const down = ZOOM_STEPS.map((step) => adjacentStep(step, -1));
    expect(up).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 8]);
    expect(down).toEqual([0.5, 0.5, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("go to the next step in that direction from a scale between two, as in mid-glide", () => {
    expect([adjacentStep(1.3, 1), adjacentStep(1.3, -1)]).toEqual([2, 1]);
    expect([adjacentStep(0.75, 1), adjacentStep(0.75, -1)]).toEqual([1, 0.5]);
    expect([adjacentStep(7.999, 1), adjacentStep(2.0000001, -1)]).toEqual([8, 1]);
    expect([adjacentStep(0.1, -1), adjacentStep(40, 1)]).toEqual([0.5, 8]);
  });

  it("read as a number of times, and a half as a half", () => {
    expect(ZOOM_STEPS.map(zoomLabel)).toEqual(["½×", "1×", "2×", "3×", "4×", "5×", "6×", "7×", "8×"]);
  });
});

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

  it("is the largest step at which the room fits, limited by whichever dimension is tighter", () => {
    const step = (width: number, height: number) => fitStep({ width, height }, room);
    // Twice the room fits exactly, and not with a pixel less either way.
    expect([step(1280, 800), step(1279, 800), step(1280, 799)]).toEqual([2, 1, 1]);
    expect([step(2000, 400), step(640, 2000)]).toEqual([1, 1]);
    expect([step(1920, 1200), step(2560, 1600)]).toEqual([3, 4]);
    // Never past the last step, however big the screen.
    expect(step(10_000, 8_000)).toBe(8);
    expect(fitView({ width: 1280, height: 800 }, room).scale).toBe(2);
  });

  it("falls back to the overview, and then to the smallest step there is, when the room does not fit", () => {
    expect(fitStep({ width: 639, height: 400 }, room)).toBe(0.5);
    expect(fitStep({ width: 320, height: 200 }, room)).toBe(0.5);
    expect(fitStep({ width: 100, height: 100 }, room)).toBe(0.5);
    expect(fitStep({ width: 0, height: 0 }, room)).toBe(0.5);
  });

  it("frames the room beside the panels, never under them", () => {
    const view = { width: 1440, height: 800 };
    const insets = { left: 266, right: 356, top: 0, bottom: 0 };
    const framing = fitView(view, room, insets);
    const box = onScreen(framing);
    // 818 pixels are left between the panels: once the room, not twice.
    expect(framing.scale).toBe(1);
    expect(box.left).toBeGreaterThanOrEqual(insets.left);
    expect(box.right).toBeLessThanOrEqual(view.width - insets.right);
    // centred in the free area, not in the viewport
    expect(Math.abs(box.left - insets.left - (view.width - insets.right - box.right))).toBeLessThanOrEqual(PIXEL);
  });

  it("takes a smaller step when a panel opens and gives it back when it closes", () => {
    const view = { width: 1400, height: 900 };
    const open = fitView(view, room, { left: 266, right: 0, top: 0, bottom: 0 });
    const closed = fitView(view, room, NO_INSETS);
    expect([open.scale, closed.scale]).toEqual([1, 2]);
    // Where the step stays the same, the room still moves over to make room for the panel.
    const narrow = { width: 1000, height: 800 };
    const beside = fitView(narrow, room, { left: 266, right: 0, top: 0, bottom: 0 });
    expect(beside.scale).toBe(fitView(narrow, room).scale);
    expect(beside.x).toBeGreaterThan(fitView(narrow, room).x);
  });

  it("ignores the panels when they leave no usable space", () => {
    const view = { width: 500, height: 600 };
    const cramped = { left: 266, right: 356, top: 0, bottom: 0 };
    expect(fitView(view, room, cramped)).toEqual(fitView(view, room, NO_INSETS));
  });

  it("never returns a zero or negative scale", () => {
    expect(fitView({ width: 0, height: 0 }, room).scale).toBeGreaterThan(0);
  });

  it("always rests on a step, at whole pixels, with the room inside the free area whenever it can be", () => {
    for (let width = 300; width <= 2600; width += 115) {
      for (let height = 240; height <= 1500; height += 90) {
        for (const insets of [NO_INSETS, { left: 266, right: 0, top: 0, bottom: 0 }, { left: 266, right: 356, top: 0, bottom: 0 }]) {
          const view = { width, height };
          const framing = fitView(view, room, insets);
          expect(ZOOM_STEPS).toContain(framing.scale);
          expect(Number.isInteger(framing.x) && Number.isInteger(framing.y)).toBe(true);
          // The next step up would not fit: this is the largest that does.
          const next = adjacentStep(framing.scale, 1);
          const usable = width - insets.left - insets.right >= 160;
          const freeWidth = usable ? width - insets.left - insets.right : width;
          if (next !== framing.scale) expect(room.width * next > freeWidth || room.height * next > height).toBe(true);
          if (room.width * framing.scale <= freeWidth && room.height * framing.scale <= height) {
            const box = onScreen(framing);
            expect(box.left).toBeGreaterThanOrEqual(usable ? insets.left : 0);
            expect(box.right).toBeLessThanOrEqual(usable ? width - insets.right : width);
            expect(box.top).toBeGreaterThanOrEqual(0);
            expect(box.bottom).toBeLessThanOrEqual(height);
          }
        }
      }
    }
  });
});

describe("zoomAround", () => {
  const under = (framing: Framing, anchor: { x: number; y: number }) => ({ x: (anchor.x - framing.x) / framing.scale, y: (anchor.y - framing.y) / framing.scale });

  it("keeps the spot under the pointer where it is, to the pixel", () => {
    const start = fitView({ width: 1280, height: 800 }, room); // 2×
    for (const anchor of [{ x: 0, y: 0 }, { x: 640, y: 400 }, { x: 913, y: 127 }, { x: 1279, y: 799 }]) {
      const spot = under(start, anchor);
      for (const scale of ZOOM_STEPS) {
        const zoomed = zoomAround(start, scale, anchor);
        expect(zoomed.scale).toBe(scale);
        expect(Number.isInteger(zoomed.x) && Number.isInteger(zoomed.y)).toBe(true);
        expect(Math.abs(zoomed.x + spot.x * scale - anchor.x)).toBeLessThanOrEqual(PIXEL);
        expect(Math.abs(zoomed.y + spot.y * scale - anchor.y)).toBeLessThanOrEqual(PIXEL);
      }
    }
  });

  it("moves everything else away from the pointer when zooming in, and towards it when zooming out", () => {
    const start = { scale: 2, x: 0, y: 0 };
    const anchor = { x: 400, y: 300 };
    const corner = (framing: Framing) => ({ x: framing.x, y: framing.y }); // the room's top-left corner on screen
    expect(corner(zoomAround(start, 3, anchor))).toEqual({ x: -200, y: -150 });
    expect(corner(zoomAround(start, 1, anchor))).toEqual({ x: 200, y: 150 });
  });

  it("comes back to where it started after a step in and a step out around the same spot", () => {
    const start = fitView({ width: 1280, height: 800 }, room);
    const anchor = { x: 913, y: 127 };
    for (const step of ZOOM_STEPS) {
      const back = zoomAround(zoomAround(start, step, anchor), start.scale, anchor);
      expect(back.scale).toBe(start.scale);
      expect(Math.abs(back.x - start.x)).toBeLessThanOrEqual(PIXEL);
      expect(Math.abs(back.y - start.y)).toBeLessThanOrEqual(PIXEL);
    }
  });
});

describe("keepInView", () => {
  const view = { width: 1000, height: 600 };

  it("leaves alone a view that shows the room, and every framing that fits it", () => {
    for (const size of [view, { width: 1440, height: 812 }, { width: 500, height: 300 }, { width: 200, height: 200 }]) {
      for (const insets of [NO_INSETS, { left: 266, right: 356, top: 0, bottom: 0 }]) {
        const fitted = fitView(size, room, insets);
        expect(keepInView(fitted, size, room, insets)).toBe(fitted);
      }
    }
    const aside = { scale: 2, x: -700, y: 150 };
    expect(keepInView(aside, view, room)).toBe(aside);
  });

  it("stops the room before it is out of sight, whichever way it is pushed", () => {
    const visible = (framing: Framing) => {
      const box = onScreen(framing);
      return { x: Math.min(box.right, view.width) - Math.max(box.left, 0), y: Math.min(box.bottom, view.height) - Math.max(box.top, 0) };
    };
    for (const scale of [0.5, 1, 3, 8]) {
      for (const [x, y] of [[-100_000, 0], [100_000, 0], [0, -100_000], [0, 100_000], [-100_000, 100_000]]) {
        const held = keepInView({ scale, x, y }, view, room);
        expect(held.scale).toBe(scale);
        expect(visible(held).x).toBeGreaterThanOrEqual(96);
        expect(visible(held).y).toBeGreaterThanOrEqual(96);
      }
    }
    // Pushed one way only, it is not moved the other.
    expect(keepInView({ scale: 1, x: -100_000, y: 33 }, view, room)).toEqual({ scale: 1, x: 96 - 640, y: 33 });
    expect(keepInView({ scale: 1, x: 100_000, y: 33 }, view, room)).toEqual({ scale: 1, x: 1000 - 96, y: 33 });
  });

  it("counts what is under a panel as out of sight", () => {
    const insets = { left: 266, right: 356, top: 0, bottom: 0 };
    const held = keepInView({ scale: 1, x: -100_000, y: 0 }, view, room, insets);
    // 96 pixels of the room still show to the right of the left panel.
    expect(onScreen(held).right).toBe(266 + 96);
    expect(onScreen(keepInView({ scale: 1, x: 100_000, y: 0 }, view, room, insets)).left).toBe(1000 - 356 - 96);
  });

  it("does nothing before the viewport has a size", () => {
    const anywhere = { scale: 1, x: -100_000, y: 100_000 };
    expect(keepInView(anywhere, { width: 0, height: 0 }, room)).toBe(anywhere);
  });
});

describe("accumulateZoom", () => {
  /** Feeds a gesture, event after event, and returns the steps it was worth and what is left. */
  function gesture(events: [delta: number, at: number][], pending: PendingZoom = NO_PENDING_ZOOM) {
    const steps: number[] = [];
    for (const [delta, at] of events) {
      const next = accumulateZoom(pending, delta, at);
      steps.push(next.steps);
      pending = next.pending;
    }
    return { steps, pending };
  }

  it("zooms in for travel up, out for travel down", () => {
    expect(accumulateZoom(NO_PENDING_ZOOM, -ZOOM_NOTCH, 1000).steps).toBe(1);
    expect(accumulateZoom(NO_PENDING_ZOOM, ZOOM_NOTCH, 1000).steps).toBe(-1);
    expect(accumulateZoom(NO_PENDING_ZOOM, 0, 1000).steps).toBe(0);
  });

  it("makes one notch of a mouse wheel exactly one step, however big the browser says the notch is", () => {
    for (const notch of [-100, -120, -53, -4000]) {
      const { steps, pending } = accumulateZoom(NO_PENDING_ZOOM, notch, 1000);
      expect(steps).toBe(1);
      expect(pending.travel).toBe(0);
    }
    // Three notches in a row are three steps, not one and not six.
    expect(gesture([[100, 1000], [100, 1040], [100, 1080]]).steps).toEqual([-1, -1, -1]);
  });

  it("adds a pinch up, event after event, until it is worth a step", () => {
    const pinch = gesture([[-8, 1000], [-8, 1016], [-8, 1032], [-8, 1048], [-8, 1064], [-8, 1080]]);
    expect(pinch.steps).toEqual([0, 0, 0, 0, 1, 0]);
    expect(pinch.pending.travel).toBe(-8);
  });

  it("carries what is left over towards the next step", () => {
    const pinch = gesture([[-25, 1000], [-25, 1016], [-25, 1032], [-25, 1048]]);
    // 50 is a step and 10 over; 100 is two steps and 20 over, the second of them at the fourth event.
    expect(pinch.steps).toEqual([0, 1, 0, 1]);
    expect(pinch.pending.travel).toBe(-20);
  });

  it("starts over when the gesture turns round", () => {
    const turned = gesture([[-30, 1000], [30, 1016]]);
    expect(turned.steps).toEqual([0, 0]);
    expect(turned.pending.travel).toBe(30);
    expect(gesture([[-30, 1000], [30, 1016], [30, 1032]]).steps).toEqual([0, 0, -1]);
  });

  it("forgets a gesture that paused", () => {
    expect(gesture([[-30, 1000], [-30, 1200]]).steps).toEqual([0, 1]);
    const paused = gesture([[-30, 1000], [-30, 1300]]);
    expect(paused.steps).toEqual([0, 0]);
    expect(paused.pending).toEqual({ travel: -30, at: 1300 });
  });
});

describe("what a wheel and a pinch report", () => {
  it("is taken in pixels whatever unit the browser used", () => {
    const page = { width: 1000, height: 600 };
    expect(wheelPixels({ deltaX: 3, deltaY: -7.5, deltaMode: 0 }, page)).toEqual({ x: 3, y: -7.5 });
    // Three lines a notch, as Firefox reports a mouse wheel: more than a zoom notch, so one step.
    expect(wheelPixels({ deltaX: 0, deltaY: 3, deltaMode: 1 }, page)).toEqual({ x: 0, y: 96 });
    expect(wheelPixels({ deltaX: 0, deltaY: 3, deltaMode: 1 }, page).y).toBeGreaterThanOrEqual(ZOOM_NOTCH);
    expect(wheelPixels({ deltaX: 1, deltaY: -1, deltaMode: 2 }, page)).toEqual({ x: 1000, y: -600 });
  });

  it("turns fingers spreading into travel up, and fingers closing into travel down", () => {
    expect(pinchTravel(1, 2)).toBeCloseTo(-69.3, 1);
    expect(pinchTravel(2, 1)).toBeCloseTo(69.3, 1);
    expect(pinchTravel(1.5, 1.5)).toBeCloseTo(0);
    // Spreading the fingers to twice as far apart is worth one step, and most of another.
    expect(Math.trunc(-pinchTravel(1, 2) / ZOOM_NOTCH)).toBe(1);
    // Nonsense in, nothing out.
    expect([pinchTravel(0, 2), pinchTravel(1, 0), pinchTravel(-1, 2), pinchTravel(1, Number.NaN)]).toEqual([0, 0, 0, 0]);
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

