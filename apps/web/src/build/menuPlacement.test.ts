import { describe, expect, it } from "vitest";
import { placeMenu } from "./menuPlacement";

const stage = { width: 1440, height: 800 };
const menu = { width: 300, height: 400 };
const none = { left: 0, right: 0 };

describe("placeMenu", () => {
  it("lays the menu to the right of the thing, clear of it, centred on it", () => {
    expect(placeMenu({ x: 500, y: 400 }, menu, stage, none, 60)).toEqual({ left: 560, top: 200, side: "right" });
  });

  it("goes to the left when there is no room on the right", () => {
    expect(placeMenu({ x: 1300, y: 400 }, menu, stage, none, 60)).toEqual({ left: 1300 - 60 - 300, top: 200, side: "left" });
  });

  it("stays out from under the side panels", () => {
    const insets = { left: 266, right: 356 };
    // Room on the right of the thing, but the inspector is there.
    const beside = placeMenu({ x: 900, y: 400 }, menu, stage, insets, 60);
    expect(beside.side).toBe("left");
    expect(beside.left + menu.width).toBeLessThanOrEqual(900 - 60);
    expect(beside.left).toBeGreaterThanOrEqual(266);
    // Something right against the office panel: the menu goes right, and not under the panel.
    const atTheEdge = placeMenu({ x: 280, y: 400 }, menu, stage, insets, 60);
    expect(atTheEdge.side).toBe("right");
    expect(atTheEdge.left).toBeGreaterThanOrEqual(266);
  });

  it("stays on screen top and bottom", () => {
    expect(placeMenu({ x: 500, y: 10 }, menu, stage, none, 60).top).toBe(8);
    expect(placeMenu({ x: 500, y: 795 }, menu, stage, none, 60).top).toBe(800 - 400 - 8);
    // Taller than the stage: it starts at the top, and scrolls inside.
    expect(placeMenu({ x: 500, y: 400 }, { width: 300, height: 2000 }, stage, none, 60).top).toBe(8);
  });

  it("makes do when the free space is narrower than the menu and what it would clear", () => {
    const narrow = { width: 700, height: 600 };
    const insets = { left: 266, right: 0 };
    for (const x of [270, 400, 500, 690]) {
      const placed = placeMenu({ x, y: 300 }, menu, narrow, insets, 80);
      expect(placed.left).toBeGreaterThanOrEqual(266);
      expect(placed.left + menu.width).toBeLessThanOrEqual(narrow.width);
    }
    // Panels that leave no room for the menu at all are ignored, as the camera ignores them.
    const cramped = placeMenu({ x: 200, y: 300 }, menu, { width: 500, height: 600 }, { left: 266, right: 100 }, 20);
    expect(cramped.left).toBeGreaterThanOrEqual(8);
    expect(cramped.left + menu.width).toBeLessThanOrEqual(500);
  });

  it("answers in whole pixels, for a thing anywhere, even off screen", () => {
    for (const anchor of [{ x: -500, y: -500 }, { x: 3000, y: 3000 }, { x: 512.4, y: 301.7 }]) {
      const placed = placeMenu(anchor, menu, stage, none, 33.3);
      expect(Number.isInteger(placed.left) && Number.isInteger(placed.top)).toBe(true);
      expect(placed.left).toBeGreaterThanOrEqual(8);
      expect(placed.left + menu.width).toBeLessThanOrEqual(stage.width - 8);
      expect(placed.top).toBeGreaterThanOrEqual(8);
      expect(placed.top + menu.height).toBeLessThanOrEqual(stage.height - 8);
    }
  });
});
