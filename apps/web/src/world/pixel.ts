import { Text, type Graphics } from "pixi.js";
import { ICONS, runs, type IconName } from "../pixel/bitmaps";

// What the world shares with the interface around it: the two pixel fonts and the icons.
// Text is drawn once at its own size, one texel per font pixel, and the camera's whole
// zoom steps do the rest: nothing here is ever smoothed.

const INK = 0x1a1c2c;

/** The fonts of pixel.css. A canvas draws in a font only once the browser has it. */
const BODY = { family: "DotGothic16", size: 16 };
const SMALL = { family: "Silkscreen", size: 8 };

/** How long the world waits for its fonts before drawing in whatever the browser has. */
const FONT_WAIT_MS = 1500;

/** Resolves when the world's fonts can be drawn with. Never rejects, and never waits long. */
export async function loadWorldFonts(): Promise<void> {
  const fonts = globalThis.document?.fonts;
  if (!fonts) return;
  const loaded = Promise.all([BODY, SMALL].map((font) => fonts.load(`${font.size}px "${font.family}"`)));
  const givenUp = new Promise<void>((resolve) => setTimeout(resolve, FONT_WAIT_MS));
  await Promise.race([loaded, givenUp]).catch(() => undefined);
}

interface PixelTextOptions {
  fill: number;
  /** The tiny capitals of a tag (IN, OUT, v2) instead of the body font. */
  small?: boolean;
  /** One pixel of ink around every letter, for text that lies on the floor. */
  outlined?: boolean;
}

/** A line of text in the world. */
export function pixelText(text: string, { fill, small = false, outlined = false }: PixelTextOptions): Text {
  const font = small ? SMALL : BODY;
  return new Text({
    text,
    style: {
      fontFamily: font.family,
      fontSize: font.size,
      fill,
      // Two wide and centred on the edge of the letter: one pixel of it shows, outside.
      ...(outlined ? { stroke: { color: INK, width: 2, join: "miter" as const } } : {}),
    },
    resolution: 1,
    textureStyle: { scaleMode: "nearest" },
    roundPixels: true,
  });
}

/** Where to put something `width` wide so that it is centred on x = 0, on a whole pixel. */
export function centred(width: number): number {
  return -Math.round(width / 2);
}

/** Draws an icon from its bitmap, `scale` world pixels per pixel, its top-left corner at (x, y). */
export function drawIcon(g: Graphics, name: IconName, x: number, y: number, scale: number, color: number): void {
  for (const run of runs(ICONS[name])) g.rect(x + run.x * scale, y + run.y * scale, run.width * scale, scale);
  g.fill(color);
}
