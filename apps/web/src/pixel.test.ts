import { describe, expect, it } from "vitest";
import chrome from "./pixel.css?raw";
import layout from "./styles.css?raw";

// The rules of the game's chrome (AGENTS.md §29), read from the stylesheets themselves:
// a rounded corner or a shadow that comes back fails here, not in somebody's eye.

interface Declaration {
  sheet: string;
  selector: string;
  property: string;
  value: string;
}

/** Every `property: value` of a stylesheet, with the selector it belongs to. Comments and data URIs are not rules. */
export function declarations(sheet: string, css: string): Declaration[] {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/url\("[^"]*"\)/g, "url()");
  const found: Declaration[] = [];
  for (const block of bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = block[1].trim().replace(/\s+/g, " ");
    for (const line of block[2].split(";")) {
      const colon = line.indexOf(":");
      if (colon < 0) continue;
      found.push({ sheet, selector, property: line.slice(0, colon).trim(), value: line.slice(colon + 1).trim().replace(/\s+/g, " ") });
    }
  }
  return found;
}

const all = [...declarations("pixel.css", chrome), ...declarations("styles.css", layout)];
const where = (declaration: Declaration) => `${declaration.sheet} ${declaration.selector} { ${declaration.property}: ${declaration.value} }`;

describe("reading a stylesheet", () => {
  it("finds every declaration with its selector, and skips comments and images", () => {
    const css = `/* a { border-radius: 4px } */
      .a, .b { color: red; border: 2px solid var(--ink) }
      :root { --frame: url("data:image/svg+xml,<svg width='12' rx='3'/>"); }`;
    expect(declarations("t", css)).toEqual([
      { sheet: "t", selector: ".a, .b", property: "color", value: "red" },
      { sheet: "t", selector: ".a, .b", property: "border", value: "2px solid var(--ink)" },
      { sheet: "t", selector: ":root", property: "--frame", value: "url()" },
    ]);
  });

  it("reads both stylesheets of the interface", () => {
    expect(declarations("pixel.css", chrome).length).toBeGreaterThan(100);
    expect(declarations("styles.css", layout).length).toBeGreaterThan(300);
  });
});

describe("the chrome is flat", () => {
  it("has no rounded corners", () => {
    // Zero is said once, to square a slider thumb some browsers draw round.
    const rounded = all.filter((declaration) => declaration.property.endsWith("radius") && declaration.value !== "0");
    expect(rounded.map(where)).toEqual([]);
  });

  it("has no shadows", () => {
    const shadows = all.filter((declaration) => declaration.property.endsWith("shadow") && declaration.value !== "none");
    expect(shadows.map(where)).toEqual([]);
  });

  it("has no blur and no filters", () => {
    const blurred = all.filter((declaration) => /(^|-)filter$/.test(declaration.property) || /blur\(/.test(declaration.value));
    expect(blurred.map(where)).toEqual([]);
  });

  it("draws every line two pixels thick, or a whole number of them", () => {
    const lines = all.filter((declaration) => /^(border|outline)(-(top|right|bottom|left))?(-width)?$/.test(declaration.property));
    expect(lines.length).toBeGreaterThan(40);
    for (const declaration of lines) {
      for (const width of declaration.value.matchAll(/(\d+(?:\.\d+)?)px/g)) expect(Number(width[1]) % 2, where(declaration)).toBe(0);
    }
  });
});

describe("the type is on its pixels", () => {
  const fonts = all.filter((declaration) => declaration.property === "font" && declaration.value !== "inherit");
  const size = (declaration: Declaration) => Number(/(\d+(?:\.\d+)?)px/.exec(declaration.value)?.[1]);

  it("sets a font only as a whole: size, line and family together", () => {
    const loose = all.filter((declaration) => ["font-size", "font-family", "line-height"].includes(declaration.property));
    // Inheriting is not setting: a small or a textarea takes what is around it.
    expect(loose.filter((declaration) => declaration.value !== "inherit" && declaration.value !== "0").map(where)).toEqual([]);
    expect(fonts.length).toBeGreaterThan(10);
  });

  it("draws the body font at 16 pixels and the title font at a multiple of 8, never in between", () => {
    for (const declaration of fonts) {
      const family = /var\(--font-(body|title)\)/.exec(declaration.value)?.[1];
      expect(family, where(declaration)).toBeDefined();
      expect(size(declaration) % (family === "body" ? 16 : 8), where(declaration)).toBe(0);
    }
  });

  it("puts every line of text on a whole number of pixels", () => {
    for (const declaration of fonts) {
      const line = Number(/px\/(\d+(?:\.\d+)?)px/.exec(declaration.value)?.[1]);
      // Text on a canvas of its own (the graph's edge labels) has no line height to set.
      if (Number.isNaN(line)) continue;
      expect(Number.isInteger(line) && line >= size(declaration), where(declaration)).toBe(true);
    }
  });

  it("invents no bold and no italic: neither font has one", () => {
    const weights = all.filter((declaration) => declaration.property === "font-weight" || declaration.property === "font-style");
    expect(weights.filter((declaration) => !["400", "normal"].includes(declaration.value)).map(where)).toEqual([]);
    for (const declaration of fonts) expect(declaration.value, where(declaration)).toMatch(/^400 /);
    expect(all.some((declaration) => declaration.property === "font-synthesis" && declaration.value === "none")).toBe(true);
  });

  it("names the two fonts the world draws with", () => {
    const root = all.filter((declaration) => declaration.selector === ":root");
    expect(root.find((declaration) => declaration.property === "--font-body")?.value).toMatch(/^"DotGothic16"/);
    expect(root.find((declaration) => declaration.property === "--font-title")?.value).toMatch(/^"Silkscreen"/);
  });
});

describe("the palette is the world's", () => {
  it("takes its ink, floor and wall from the room", () => {
    const root = Object.fromEntries(all.filter((declaration) => declaration.selector === ":root").map((declaration) => [declaration.property, declaration.value]));
    // The same numbers as world/PixelWorld.ts draws the room with.
    expect([root["--ink"], root["--void"], root["--wall"], root["--wall-dark"], root["--floor"], root["--floor-light"]]).toEqual([
      "#1a1c2c",
      "#14161f",
      "#262b44",
      "#1d2136",
      "#3b4263",
      "#414a6e",
    ]);
  });
});
