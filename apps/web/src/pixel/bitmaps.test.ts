import { describe, expect, it } from "vitest";
import { ICONS, runs, sizeOf, toolIcon, type IconName } from "./bitmaps";

const names = Object.keys(ICONS) as IconName[];
const drawn = (bitmap: readonly string[]) => bitmap.join("").split("#").length - 1;

describe("icon bitmaps", () => {
  it("are rectangles of drawn and empty pixels, and nothing else", () => {
    for (const name of names) {
      const bitmap = ICONS[name];
      const { width, height } = sizeOf(bitmap);
      expect(height, name).toBeGreaterThan(0);
      for (const row of bitmap) {
        expect(row.length, name).toBe(width);
        expect(row, name).toMatch(/^[#.]+$/);
      }
      expect(drawn(bitmap), name).toBeGreaterThan(0);
    }
  });

  it("come in three sizes: windows and tools 12, statuses 7, controls 8", () => {
    const size = (name: IconName) => sizeOf(ICONS[name]);
    for (const name of ["office", "inspector", "log", "timeline", "graph", "help", "web_search", "send_email", "calculator", "tool"] as const) {
      expect(size(name), name).toEqual({ width: 12, height: 12 });
    }
    for (const name of ["thinking", "waiting", "working", "error"] as const) expect(size(name), name).toEqual({ width: 7, height: 7 });
    for (const name of ["play", "pause", "next", "previous", "start", "close", "minus", "plus", "up", "down", "open", "closed", "collapse"] as const) {
      expect(size(name), name).toEqual({ width: 8, height: 8 });
    }
    // Nothing is left out of the three lists above.
    expect(names).toHaveLength(10 + 4 + 13);
  });

  it("are no two the same", () => {
    expect(new Set(names.map((name) => ICONS[name].join("\n"))).size).toBe(names.length);
  });
});

describe("sizeOf", () => {
  it("measures a bitmap in its own pixels", () => {
    expect(sizeOf(["#..", "..#"])).toEqual({ width: 3, height: 2 });
    expect(sizeOf([])).toEqual({ width: 0, height: 0 });
  });
});

describe("runs", () => {
  it("turns each stretch of drawn pixels into one rectangle a pixel high", () => {
    expect(runs(["##.#", "....", ".###"])).toEqual([
      { x: 0, y: 0, width: 2 },
      { x: 3, y: 0, width: 1 },
      { x: 1, y: 2, width: 3 },
    ]);
    expect(runs(["...."])).toEqual([]);
    expect(runs(["####"])).toEqual([{ x: 0, y: 0, width: 4 }]);
  });

  it("covers every drawn pixel of every icon exactly once, in as few pieces as a row allows", () => {
    for (const name of names) {
      const bitmap = ICONS[name];
      const covered = bitmap.map((row) => Array.from(row, () => 0));
      const found = runs(bitmap);
      for (const run of found) {
        expect(run.width, name).toBeGreaterThan(0);
        for (let x = run.x; x < run.x + run.width; x++) covered[run.y][x] += 1;
      }
      bitmap.forEach((row, y) => Array.from(row).forEach((pixel, x) => expect(covered[y][x], `${name} ${x},${y}`).toBe(pixel === "#" ? 1 : 0)));
      // Two runs of one row never touch: they would have been one.
      for (const run of found) {
        expect(found.some((other) => other.y === run.y && other.x === run.x + run.width), name).toBe(false);
      }
      expect(found.reduce((sum, run) => sum + run.width, 0), name).toBe(drawn(bitmap));
    }
  });
});

describe("toolIcon", () => {
  it("gives a tool its own icon when it has one", () => {
    expect(toolIcon("web_search")).toBe("web_search");
    expect(toolIcon("send_email")).toBe("send_email");
    expect(toolIcon("calculator")).toBe("calculator");
  });

  it("gives any other tool the same one, even a tool named like another icon", () => {
    expect(toolIcon("mcp:library/search")).toBe("tool");
    expect(toolIcon("")).toBe("tool");
    // These are icons too, of other things: a tool by that name does not get them.
    for (const name of ["office", "play", "error", "close", "toString", "tool"]) expect(toolIcon(name), name).toBe("tool");
  });
});
